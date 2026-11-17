import crypto from 'crypto';
import { db, withTransaction } from './db.ts';
import { AdminUserRecord, logAudit } from './auth.ts';

export type PairingMode = 'MUTUAL' | 'SECRET';

export interface EligibleParticipantRow {
  id: number;
  registration_reference: string;
  full_name: string;
  phone_number: string;
  email: string | null;
  residence: string;
  attendance_status: string;
  gift_exchange_consent: number;
}

export interface PairingPreview {
  mode: PairingMode;
  totalEligible: number;
  alreadyLockedGivers: number;
  availableToPair: number;
  predictedNewPairs: number;
  predictedUnpairedQueue: number;
  hasUnlockedDraft: boolean;
  canGenerate: boolean;
  reason?: string;
}

function cryptoShuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Generates a uniform random derangement of `items` (no element stays at its original index).
 * For n >= 2, expected iterations is ~e (2.718). Guaranteed no self-assignment,
 * every participant gives exactly 1 gift and receives exactly 1 gift.
 */
function generateDerangement<T extends { id: number }>(items: T[]): Array<{ giver: T; recipient: T }> {
  if (items.length < 2) {
    throw new Error('At least 2 eligible participants are required for Secret Gift Exchange.');
  }

  if (items.length === 2) {
    return [
      { giver: items[0], recipient: items[1] },
      { giver: items[1], recipient: items[0] },
    ];
  }

  // Rejection sampling with Fisher-Yates (cryptographic RNG)
  for (let attempt = 0; attempt < 500; attempt++) {
    const shuffled = cryptoShuffle(items);
    let hasFixedPoint = false;
    for (let i = 0; i < items.length; i++) {
      if (shuffled[i].id === items[i].id) {
        hasFixedPoint = true;
        break;
      }
    }
    if (!hasFixedPoint) {
      return items.map((giver, idx) => ({ giver, recipient: shuffled[idx] }));
    }
  }

  // Deterministic Sattolo cycle fallback if rejection sampling ever hits bound
  const pool = cryptoShuffle(items);
  return pool.map((giver, idx) => ({
    giver,
    recipient: pool[(idx + 1) % pool.length],
  }));
}

export function getEligiblePoolForNewPairings(eventId: number) {
  const allEligible = db
    .prepare(`
      SELECT id, registration_reference, full_name, phone_number, email, residence, attendance_status, gift_exchange_consent
      FROM participants
      WHERE event_id = ?
        AND attendance_status = 'CONFIRMED'
        AND gift_exchange_consent = 1
      ORDER BY id ASC
    `)
    .all(eventId) as unknown as EligibleParticipantRow[];

  const lockedRows = db
    .prepare(`
      SELECT giver_participant_id, recipient_participant_id
      FROM pairings
      WHERE event_id = ? AND is_locked = 1
    `)
    .all(eventId) as unknown as Array<{ giver_participant_id: number; recipient_participant_id: number }>;

  const lockedGiverIds = new Set(lockedRows.map((r) => r.giver_participant_id));
  const lockedRecipientIds = new Set(lockedRows.map((r) => r.recipient_participant_id));

  // Available participants are eligible participants not currently locked as giver OR recipient
  const available = allEligible.filter(
    (p) => !lockedGiverIds.has(p.id) && !lockedRecipientIds.has(p.id)
  );

  const draftBatch = db
    .prepare(`SELECT id FROM pairing_batches WHERE event_id = ? AND status = 'DRAFT' LIMIT 1`)
    .get(eventId) as { id: number } | undefined;

  return {
    allEligible,
    lockedGiverCount: lockedGiverIds.size,
    available,
    hasUnlockedDraft: Boolean(draftBatch),
  };
}

export function previewPairingPlan(eventId: number, mode: PairingMode): PairingPreview {
  const { allEligible, lockedGiverCount, available, hasUnlockedDraft } =
    getEligiblePoolForNewPairings(eventId);

  const n = available.length;
  if (mode === 'MUTUAL') {
    const pairCount = Math.floor(n / 2);
    const queued = n % 2;
    return {
      mode,
      totalEligible: allEligible.length,
      alreadyLockedGivers: lockedGiverCount,
      availableToPair: n,
      predictedNewPairs: pairCount * 2,
      predictedUnpairedQueue: queued,
      hasUnlockedDraft,
      canGenerate: n >= 2,
      reason: n < 2 ? 'At least 2 unlocked confirmed participants with gift consent are needed.' : undefined,
    };
  }

  return {
    mode,
    totalEligible: allEligible.length,
    alreadyLockedGivers: lockedGiverCount,
    availableToPair: n,
    predictedNewPairs: n >= 2 ? n : 0,
    predictedUnpairedQueue: n === 1 ? 1 : 0,
    hasUnlockedDraft,
    canGenerate: n >= 2,
    reason: n < 2 ? 'At least 2 unlocked confirmed participants with gift consent are needed.' : undefined,
  };
}

export function generatePairingBatch(
  eventId: number,
  mode: PairingMode,
  admin: AdminUserRecord
) {
  return withTransaction(() => {
    // Remove only unlocked draft batches & pairings for this event; NEVER touch locked pairings
    db.prepare(`DELETE FROM pairings WHERE event_id = ? AND is_locked = 0`).run(eventId);
    db.prepare(`DELETE FROM pairing_batches WHERE event_id = ? AND status = 'DRAFT'`).run(eventId);

    const { allEligible, available } = getEligiblePoolForNewPairings(eventId);

    if (available.length < 2) {
      throw new Error(
        'At least 2 eligible unlocked participants (confirmed attendance + gift consent) are required to generate pairings.'
      );
    }

    const pairsToInsert: Array<{ giverId: number; recipientId: number }> = [];
    let queuedCount = 0;

    if (mode === 'MUTUAL') {
      const shuffled = cryptoShuffle(available);
      const limit = shuffled.length - (shuffled.length % 2);
      for (let i = 0; i < limit; i += 2) {
        const p1 = shuffled[i];
        const p2 = shuffled[i + 1];
        pairsToInsert.push({ giverId: p1.id, recipientId: p2.id });
        pairsToInsert.push({ giverId: p2.id, recipientId: p1.id });
      }
      queuedCount = shuffled.length % 2;
    } else {
      const derangement = generateDerangement(available);
      for (const item of derangement) {
        pairsToInsert.push({ giverId: item.giver.id, recipientId: item.recipient.id });
      }
      queuedCount = 0;
    }

    const batchResult = db
      .prepare(`
        INSERT INTO pairing_batches (event_id, pairing_mode, total_eligible, total_paired, total_queued, status)
        VALUES (?, ?, ?, ?, ?, 'DRAFT')
      `)
      .run(eventId, mode, allEligible.length, pairsToInsert.length, queuedCount);

    const batchId = Number(batchResult.lastInsertRowid);

    const insertPairing = db.prepare(`
      INSERT INTO pairings (pairing_batch_id, event_id, giver_participant_id, recipient_participant_id, pairing_mode, is_locked)
      VALUES (?, ?, ?, ?, ?, 0)
    `);

    for (const pair of pairsToInsert) {
      insertPairing.run(batchId, eventId, pair.giverId, pair.recipientId, mode);
    }

    logAudit(
      admin,
      'GENERATE_PAIRINGS',
      `Batch #${batchId}`,
      `Mode=${mode}, Paired=${pairsToInsert.length}, Queued=${queuedCount}`
    );

    return {
      batchId,
      mode,
      totalEligible: allEligible.length,
      totalPaired: pairsToInsert.length,
      totalQueued: queuedCount,
      status: 'DRAFT' as const,
    };
  });
}

export function lockPairingBatch(eventId: number, batchId: number, admin: AdminUserRecord) {
  return withTransaction(() => {
    const batch = db
      .prepare(`SELECT id, status, pairing_mode FROM pairing_batches WHERE id = ? AND event_id = ?`)
      .get(batchId, eventId) as { id: number; status: string; pairing_mode: string } | undefined;

    if (!batch) {
      throw new Error('Pairing batch not found.');
    }
    if (batch.status === 'LOCKED') {
      throw new Error('This pairing batch is already locked.');
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE pairing_batches
      SET status = 'LOCKED', locked_at = ?
      WHERE id = ?
    `).run(now, batchId);

    const updated = db
      .prepare(`
        UPDATE pairings
        SET is_locked = 1, locked_at = ?
        WHERE pairing_batch_id = ? AND event_id = ?
      `)
      .run(now, batchId, eventId);

    logAudit(
      admin,
      'LOCK_PAIRINGS',
      `Batch #${batchId}`,
      `Locked ${Number(updated.changes)} assignments (${batch.pairing_mode})`
    );

    return { batchId, lockedCount: Number(updated.changes), lockedAt: now };
  });
}

export function discardDraftBatch(eventId: number, batchId: number, admin: AdminUserRecord) {
  return withTransaction(() => {
    const batch = db
      .prepare(`SELECT id, status FROM pairing_batches WHERE id = ? AND event_id = ?`)
      .get(batchId, eventId) as { id: number; status: string } | undefined;

    if (!batch) {
      throw new Error('Pairing batch not found.');
    }
    if (batch.status === 'LOCKED') {
      throw new Error('Locked pairing batches cannot be discarded.');
    }

    db.prepare(`DELETE FROM pairings WHERE pairing_batch_id = ? AND is_locked = 0`).run(batchId);
    db.prepare(`DELETE FROM pairing_batches WHERE id = ?`).run(batchId);

    logAudit(admin, 'DISCARD_DRAFT_BATCH', `Batch #${batchId}`, 'Discarded unlocked draft pairings');
    return { batchId };
  });
}

export function reassignPairings(
  eventId: number,
  payload: {
    action: 'UNLINK_PARTICIPANT' | 'SWAP_RECIPIENTS' | 'MANUAL_PAIR';
    participantId?: number;
    pairingIdA?: number;
    pairingIdB?: number;
    giverId?: number;
    recipientId?: number;
    mutual?: boolean;
  },
  admin: AdminUserRecord
) {
  return withTransaction(() => {
    if (payload.action === 'UNLINK_PARTICIPANT') {
      if (!payload.participantId) throw new Error('participantId is required.');
      const affected = db
        .prepare(`
          SELECT id, giver_participant_id, recipient_participant_id
          FROM pairings
          WHERE event_id = ? AND (giver_participant_id = ? OR recipient_participant_id = ?)
        `)
        .all(eventId, payload.participantId, payload.participantId) as Array<{
        id: number;
        giver_participant_id: number;
        recipient_participant_id: number;
      }>;

      if (affected.length === 0) {
        throw new Error('Participant has no active pairing to unlink.');
      }

      db.prepare(`
        DELETE FROM pairings
        WHERE event_id = ? AND (giver_participant_id = ? OR recipient_participant_id = ?)
      `).run(eventId, payload.participantId, payload.participantId);

      logAudit(
        admin,
        'UNLINK_PAIRING',
        `Participant #${payload.participantId}`,
        `Removed ${affected.length} pairing link(s) due to withdrawal/reassignment`
      );
      return { unlinkedCount: affected.length };
    }

    if (payload.action === 'SWAP_RECIPIENTS') {
      if (!payload.pairingIdA || !payload.pairingIdB) {
        throw new Error('Both pairingIdA and pairingIdB are required to swap recipients.');
      }
      if (payload.pairingIdA === payload.pairingIdB) {
        throw new Error('Select two different pairings to swap.');
      }

      const pA = db
        .prepare(`SELECT * FROM pairings WHERE id = ? AND event_id = ?`)
        .get(payload.pairingIdA, eventId) as
        | {
            id: number;
            pairing_batch_id: number;
            giver_participant_id: number;
            recipient_participant_id: number;
            pairing_mode: PairingMode;
            is_locked: number;
            locked_at: string | null;
          }
        | undefined;
      const pB = db
        .prepare(`SELECT * FROM pairings WHERE id = ? AND event_id = ?`)
        .get(payload.pairingIdB, eventId) as
        | {
            id: number;
            pairing_batch_id: number;
            giver_participant_id: number;
            recipient_participant_id: number;
            pairing_mode: PairingMode;
            is_locked: number;
            locked_at: string | null;
          }
        | undefined;

      if (!pA || !pB) {
        throw new Error('Selected pairing record(s) not found.');
      }
      if (pA.giver_participant_id === pB.recipient_participant_id || pB.giver_participant_id === pA.recipient_participant_id) {
        throw new Error('Swapping these recipients would assign a participant to themselves.');
      }

      // Delete both temporarily to satisfy UNIQUE(event_id, recipient_participant_id), then re-insert swapped
      db.prepare(`DELETE FROM pairings WHERE id IN (?, ?)`).run(pA.id, pB.id);
      const insertStmt = db.prepare(`
        INSERT INTO pairings (pairing_batch_id, event_id, giver_participant_id, recipient_participant_id, pairing_mode, is_locked, locked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      insertStmt.run(
        pA.pairing_batch_id,
        eventId,
        pA.giver_participant_id,
        pB.recipient_participant_id,
        pA.pairing_mode,
        pA.is_locked,
        pA.locked_at
      );
      insertStmt.run(
        pB.pairing_batch_id,
        eventId,
        pB.giver_participant_id,
        pA.recipient_participant_id,
        pB.pairing_mode,
        pB.is_locked,
        pB.locked_at
      );

      logAudit(
        admin,
        'REASSIGN_SWAP',
        `Pairings #${pA.id} & #${pB.id}`,
        `Swapped recipients between giver #${pA.giver_participant_id} and giver #${pB.giver_participant_id}`
      );
      return { swapped: true };
    }

    if (payload.action === 'MANUAL_PAIR') {
      const { giverId, recipientId, mutual } = payload;
      if (!giverId || !recipientId) {
        throw new Error('Both giverId and recipientId are required.');
      }
      if (giverId === recipientId) {
        throw new Error('A participant cannot be paired with themselves.');
      }

      const giver = db
        .prepare(`SELECT id, full_name, attendance_status, gift_exchange_consent FROM participants WHERE id = ? AND event_id = ?`)
        .get(giverId, eventId) as EligibleParticipantRow | undefined;
      const recipient = db
        .prepare(`SELECT id, full_name, attendance_status, gift_exchange_consent FROM participants WHERE id = ? AND event_id = ?`)
        .get(recipientId, eventId) as EligibleParticipantRow | undefined;

      if (!giver || !recipient) {
        throw new Error('Selected participant(s) not found.');
      }
      if (
        giver.attendance_status !== 'CONFIRMED' ||
        giver.gift_exchange_consent !== 1 ||
        recipient.attendance_status !== 'CONFIRMED' ||
        recipient.gift_exchange_consent !== 1
      ) {
        throw new Error('Both participants must have confirmed attendance and gift exchange consent.');
      }

      // Ensure a manual batch exists or create one
      const mode: PairingMode = mutual ? 'MUTUAL' : 'SECRET';
      const now = new Date().toISOString();
      const batchRes = db
        .prepare(`
          INSERT INTO pairing_batches (event_id, pairing_mode, total_eligible, total_paired, total_queued, status, locked_at)
          VALUES (?, ?, 2, ?, 0, 'LOCKED', ?)
        `)
        .run(eventId, mode, mutual ? 2 : 1, now);
      const batchId = Number(batchRes.lastInsertRowid);

      const insertStmt = db.prepare(`
        INSERT INTO pairings (pairing_batch_id, event_id, giver_participant_id, recipient_participant_id, pairing_mode, is_locked, locked_at)
        VALUES (?, ?, ?, ?, ?, 1, ?)
      `);

      insertStmt.run(batchId, eventId, giverId, recipientId, mode, now);
      if (mutual) {
        insertStmt.run(batchId, eventId, recipientId, giverId, mode, now);
      }

      logAudit(
        admin,
        'MANUAL_PAIR',
        `${giver.full_name} -> ${recipient.full_name}`,
        mutual ? 'Created locked mutual pair' : 'Created locked one-way assignment'
      );
      return { batchId };
    }

    throw new Error('Unsupported reassignment action.');
  });
}
