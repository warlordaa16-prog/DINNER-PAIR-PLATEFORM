import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { db, withTransaction } from './db.ts';
import {
  AdminRequest,
  createAdminSession,
  generateNumericCode,
  getAuthenticatedAdmin,
  hashSha256,
  logAudit,
  requireAdmin,
  revokeAdminSession,
  verifyFirebaseIdToken,
} from './auth.ts';
import {
  cleanText,
  escapeCsvCell,
  escapeXml,
  isValidEmail,
  isValidPhone,
  normalizePhone,
  parseAttendanceStatus,
  parseConsent,
  parseTicketCategory,
} from './validation.ts';
import {
  discardDraftBatch,
  generatePairingBatch,
  lockPairingBatch,
  PairingMode,
  previewPairingPlan,
  reassignPairings,
} from './pairing.ts';

export const apiRouter = Router();

const publicWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP. Please wait a few minutes and try again.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many verification attempts. Please try again shortly.' },
});

function getActiveEvent() {
  return db.prepare('SELECT * FROM events ORDER BY id ASC LIMIT 1').get() as
    | {
        id: number;
        organizer_name: string;
        event_name: string;
        event_date: string;
        venue: string;
        dress_code: string;
        gift_budget: string;
        ticket_info: string;
        contact_phone: string;
        registration_deadline: string;
        event_status: 'OPEN' | 'CLOSED' | 'COMPLETED';
        allow_attendance_updates: number;
        google_form_id: string | null;
        google_form_url: string | null;
        created_at: string;
        updated_at: string;
      }
    | undefined;
}

function generateUniqueReference(): string {
  const year = new Date().getFullYear();
  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM participants').get() as { cnt: number };
  let seq = Number(countRow.cnt) + 1;
  while (true) {
    const candidate = `DP-${year}-${String(seq).padStart(4, '0')}`;
    const exists = db
      .prepare('SELECT id FROM participants WHERE registration_reference = ?')
      .get(candidate);
    if (!exists) return candidate;
    seq += 1;
  }
}

/* ============================================================================
 * PUBLIC ROUTES (No Admin Auth Required — Zero PII Leakage)
 * ========================================================================== */

apiRouter.get('/public/event', (_req, res) => {
  try {
    const event = getActiveEvent();
    if (!event) {
      res.status(404).json({ error: 'No active event configured.' });
      return;
    }

    const stats = db
      .prepare(`
        SELECT
          COUNT(*) as totalRegistrations,
          SUM(CASE WHEN attendance_status = 'CONFIRMED' THEN 1 ELSE 0 END) as confirmedCount
        FROM participants
        WHERE event_id = ?
      `)
      .get(event.id) as { totalRegistrations: number; confirmedCount: number | null };

    const lockedCount = db
      .prepare(`SELECT COUNT(*) as cnt FROM pairings WHERE event_id = ? AND is_locked = 1`)
      .get(event.id) as { cnt: number };

    res.json({
      event: {
        id: event.id,
        organizerName: event.organizer_name,
        eventName: event.event_name,
        eventDate: event.event_date,
        venue: event.venue,
        dressCode: event.dress_code,
        giftBudget: event.gift_budget,
        ticketInfo: event.ticket_info,
        contactPhone: event.contact_phone,
        registrationDeadline: event.registration_deadline,
        eventStatus: event.event_status,
        allowAttendanceUpdates: Boolean(event.allow_attendance_updates),
        googleFormUrl: event.google_form_url,
      },
      summary: {
        totalRegistrations: Number(stats.totalRegistrations || 0),
        confirmedCount: Number(stats.confirmedCount || 0),
        pairingsPublished: Number(lockedCount.cnt || 0) > 0,
      },
    });
  } catch (err) {
    console.error('Error loading public event:', err);
    res.status(500).json({ error: 'Failed to load dinner event details.' });
  }
});

apiRouter.post('/public/register', publicWriteLimiter, (req, res) => {
  try {
    const event = getActiveEvent();
    if (!event) {
      res.status(404).json({ error: 'Dinner event is not configured.' });
      return;
    }
    if (event.event_status !== 'OPEN') {
      res.status(400).json({ error: 'Registration for this dinner event is currently closed.' });
      return;
    }

    const fullName = cleanText(req.body?.fullName, 120);
    const phoneNumber = normalizePhone(req.body?.phoneNumber);
    const email = cleanText(req.body?.email, 254).toLowerCase();
    const residence = cleanText(req.body?.residence, 160);
    const ticketCategory = parseTicketCategory(req.body?.ticketCategory) ?? 'STUDENT';
    const attendanceStatus = parseAttendanceStatus(req.body?.attendanceStatus);
    const giftExchangeConsent = parseConsent(req.body?.giftExchangeConsent);

    if (!fullName || fullName.length < 2) {
      res.status(400).json({ error: 'Please enter your full name.' });
      return;
    }
    if (!phoneNumber || !isValidPhone(phoneNumber)) {
      res.status(400).json({ error: 'Please enter a valid telephone or WhatsApp number (7–15 digits).' });
      return;
    }
    if (email && !isValidEmail(email)) {
      res.status(400).json({ error: 'Please provide a valid email address or leave it blank.' });
      return;
    }
    if (!residence || residence.length < 2) {
      res.status(400).json({ error: 'Please enter your residence or campus location.' });
      return;
    }
    if (!attendanceStatus) {
      res.status(400).json({ error: 'Please select your dinner attendance confirmation status.' });
      return;
    }
    if (giftExchangeConsent === null) {
      res.status(400).json({ error: 'Please select your gift exchange participation consent.' });
      return;
    }

    const existing = db
      .prepare('SELECT id, registration_reference FROM participants WHERE event_id = ? AND phone_number = ?')
      .get(event.id, phoneNumber) as { id: number; registration_reference: string } | undefined;

    if (existing) {
      res.status(409).json({
        error: `This telephone number is already registered under reference ${existing.registration_reference}.`,
        existingReference: existing.registration_reference,
      });
      return;
    }

    const accessCode = generateNumericCode(6);
    const accessCodeHash = hashSha256(accessCode);

    const created = withTransaction(() => {
      const reference = generateUniqueReference();
      const result = db
        .prepare(`
          INSERT INTO participants (
            event_id, registration_reference, full_name, phone_number, email, residence,
            ticket_category, attendance_status, gift_exchange_consent, access_code_hash, source
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'WEB')
        `)
        .run(
          event.id,
          reference,
          fullName,
          phoneNumber,
          email || null,
          residence,
          ticketCategory,
          attendanceStatus,
          giftExchangeConsent ? 1 : 0,
          accessCodeHash
        );

      return {
        id: Number(result.lastInsertRowid),
        registrationReference: reference,
      };
    });

    res.status(201).json({
      message: 'Registration completed successfully.',
      registration: {
        registrationReference: created.registrationReference,
        fullName,
        ticketCategory,
        attendanceStatus,
        giftExchangeConsent,
        personalAccessCode: accessCode,
        eventName: event.event_name,
        eventDate: event.event_date,
        venue: event.venue,
      },
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Unable to complete registration. Please try again.' });
  }
});

apiRouter.post('/public/assignment/request-otp', authLimiter, async (req, res) => {
  try {
    const event = getActiveEvent();
    if (!event) {
      res.status(404).json({ error: 'No active event found.' });
      return;
    }

    const registrationReference = cleanText(req.body?.registrationReference, 40).toUpperCase();
    const phoneNumber = normalizePhone(req.body?.phoneNumber);

    if (!registrationReference || !phoneNumber) {
      res.status(400).json({ error: 'Registration reference and registered telephone number are required.' });
      return;
    }

    const participant = db
      .prepare(`
        SELECT id, full_name, phone_number
        FROM participants
        WHERE event_id = ? AND registration_reference = ? AND phone_number = ?
      `)
      .get(event.id, registrationReference, phoneNumber) as
      | { id: number; full_name: string; phone_number: string }
      | undefined;

    if (!participant) {
      res.status(404).json({ error: 'No registration matched that reference number and telephone number.' });
      return;
    }

    const otp = generateNumericCode(6);
    const otpHash = hashSha256(otp);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    db.prepare(`
      UPDATE participants
      SET verification_code_hash = ?, verification_code_expires_at = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(otpHash, expiresAt, participant.id);

    // Optional real SMS webhook dispatch if configured in environment
    const webhookUrl = process.env.SMS_WEBHOOK_URL;
    let smsDispatched = false;
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: participant.phone_number,
            message: `Dinner Pair verification code for ${registrationReference}: ${otp} (valid 10 minutes).`,
          }),
        });
        smsDispatched = true;
      } catch (smsErr) {
        console.error('SMS webhook error:', smsErr);
      }
    }

    const maskedPhone =
      participant.phone_number.length > 4
        ? `${'*'.repeat(Math.max(0, participant.phone_number.length - 4))}${participant.phone_number.slice(-4)}`
        : '****';

    res.json({
      message: smsDispatched
        ? `A 6-digit one-time verification code has been sent to ${maskedPhone}.`
        : `A 6-digit verification code has been generated for ${maskedPhone}. Contact your event administrator if you did not save your personal access code.`,
      maskedPhone,
      expiresInMinutes: 10,
    });
  } catch (err) {
    console.error('OTP request error:', err);
    res.status(500).json({ error: 'Failed to issue verification code.' });
  }
});

type VerifyCredentialsResult =
  | { ok: false; error: string; status: 400 | 401 }
  | {
      ok: true;
      participant: {
        id: number;
        registration_reference: string;
        full_name: string;
        ticket_category: 'STUDENT' | 'ALUMNI';
        attendance_status: 'CONFIRMED' | 'PENDING' | 'DECLINED';
        gift_exchange_consent: number;
        access_code_hash: string;
        verification_code_hash: string | null;
        verification_code_expires_at: string | null;
      };
    };

function verifyParticipantCredentials(
  eventId: number,
  refRaw: unknown,
  phoneRaw: unknown,
  codeRaw: unknown
): VerifyCredentialsResult {
  const registrationReference = cleanText(refRaw, 40).toUpperCase();
  const phoneNumber = normalizePhone(phoneRaw);
  const code = cleanText(codeRaw, 16);

  if (!registrationReference || !phoneNumber || !code) {
    return {
      ok: false,
      error: 'Registration reference, telephone number, and verification code are required.',
      status: 400,
    };
  }

  const participant = db
    .prepare(`
      SELECT id, registration_reference, full_name, ticket_category, attendance_status, gift_exchange_consent,
             access_code_hash, verification_code_hash, verification_code_expires_at
      FROM participants
      WHERE event_id = ? AND registration_reference = ? AND phone_number = ?
    `)
    .get(eventId, registrationReference, phoneNumber) as
    | {
        id: number;
        registration_reference: string;
        full_name: string;
        ticket_category: 'STUDENT' | 'ALUMNI';
        attendance_status: 'CONFIRMED' | 'PENDING' | 'DECLINED';
        gift_exchange_consent: number;
        access_code_hash: string;
        verification_code_hash: string | null;
        verification_code_expires_at: string | null;
      }
    | undefined;

  if (!participant) {
    return {
      ok: false,
      error: 'Invalid registration reference or telephone number.',
      status: 401,
    };
  }

  const providedHash = hashSha256(code);
  const matchesPersonalCode = providedHash === participant.access_code_hash;
  const matchesOtp =
    Boolean(participant.verification_code_hash) &&
    Boolean(participant.verification_code_expires_at) &&
    new Date(participant.verification_code_expires_at!).getTime() > Date.now() &&
    providedHash === participant.verification_code_hash;

  if (!matchesPersonalCode && !matchesOtp) {
    return {
      ok: false,
      error: 'Invalid or expired verification code.',
      status: 401,
    };
  }

  return { ok: true, participant };
}

apiRouter.post('/public/assignment/verify', authLimiter, (req, res) => {
  try {
    const event = getActiveEvent();
    if (!event) {
      res.status(404).json({ error: 'No active event found.' });
      return;
    }

    const authResult = verifyParticipantCredentials(
      event.id,
      req.body?.registrationReference,
      req.body?.phoneNumber,
      req.body?.verificationCode
    );

    if (!authResult.ok) {
      res.status(authResult.status).json({ error: authResult.error });
      return;
    }

    const { participant } = authResult;

    // Clear one-time OTP after successful verification (personal access code remains valid)
    db.prepare(`UPDATE participants SET verification_code_hash = NULL, verification_code_expires_at = NULL WHERE id = ?`).run(
      participant.id
    );

    const lockedAssignment = db
      .prepare(`
        SELECT p.pairing_mode, p.locked_at, r.full_name as recipient_full_name
        FROM pairings p
        JOIN participants r ON r.id = p.recipient_participant_id
        WHERE p.event_id = ? AND p.giver_participant_id = ? AND p.is_locked = 1
        LIMIT 1
      `)
      .get(event.id, participant.id) as
      | { pairing_mode: PairingMode; locked_at: string; recipient_full_name: string }
      | undefined;

    res.json({
      participant: {
        registrationReference: participant.registration_reference,
        fullName: participant.full_name,
        ticketCategory: participant.ticket_category === 'ALUMNI' ? 'ALUMNI' : 'STUDENT',
        attendanceStatus: participant.attendance_status,
        giftExchangeConsent: Boolean(participant.gift_exchange_consent),
      },
      assignment: lockedAssignment
        ? {
            assignedRecipientName: lockedAssignment.recipient_full_name,
            pairingMode: lockedAssignment.pairing_mode,
            lockedAt: lockedAssignment.locked_at,
          }
        : null,
      event: {
        organizerName: event.organizer_name,
        eventName: event.event_name,
        eventDate: event.event_date,
        venue: event.venue,
        dressCode: event.dress_code,
        giftBudget: event.gift_budget,
        ticketInfo: event.ticket_info,
        contactPhone: event.contact_phone,
        registrationDeadline: event.registration_deadline,
        eventStatus: event.event_status,
        allowAttendanceUpdates: Boolean(event.allow_attendance_updates),
      },
    });
  } catch (err) {
    console.error('Assignment verification error:', err);
    res.status(500).json({ error: 'Unable to retrieve your gift assignment right now.' });
  }
});

apiRouter.patch('/public/attendance', authLimiter, (req, res) => {
  try {
    const event = getActiveEvent();
    if (!event) {
      res.status(404).json({ error: 'No active event found.' });
      return;
    }
    if (!event.allow_attendance_updates) {
      res.status(403).json({ error: 'Self-service attendance updates are currently locked by the event administrator.' });
      return;
    }

    const authResult = verifyParticipantCredentials(
      event.id,
      req.body?.registrationReference,
      req.body?.phoneNumber,
      req.body?.verificationCode
    );
    if (!authResult.ok) {
      res.status(authResult.status).json({ error: authResult.error });
      return;
    }

    const newStatus = parseAttendanceStatus(req.body?.attendanceStatus);
    if (!newStatus) {
      res.status(400).json({ error: 'Invalid attendance status.' });
      return;
    }

    const newConsent =
      req.body?.giftExchangeConsent !== undefined ? parseConsent(req.body.giftExchangeConsent) : null;

    const { participant } = authResult;
    db.prepare(`
      UPDATE participants
      SET attendance_status = ?,
          gift_exchange_consent = COALESCE(?, gift_exchange_consent),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(newStatus, newConsent === null ? null : newConsent ? 1 : 0, participant.id);

    res.json({
      message: 'Your attendance status has been updated.',
      attendanceStatus: newStatus,
      giftExchangeConsent:
        newConsent === null ? Boolean(participant.gift_exchange_consent) : newConsent,
    });
  } catch (err) {
    console.error('Attendance update error:', err);
    res.status(500).json({ error: 'Failed to update attendance status.' });
  }
});

/* ============================================================================
 * ADMINISTRATOR AUTHENTICATION ROUTES
 * ========================================================================== */

apiRouter.post('/admin/login', authLimiter, (req, res) => {
  try {
    const identifier = cleanText(req.body?.identifier, 120).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!identifier || !password) {
      res.status(400).json({ error: 'Username/email and password are required.' });
      return;
    }

    const admin = db
      .prepare(`
        SELECT id, username, email, password_hash, role
        FROM administrators
        WHERE lower(username) = ? OR lower(email) = ?
        LIMIT 1
      `)
      .get(identifier, identifier) as
      | { id: number; username: string; email: string; password_hash: string; role: 'SUPER_ADMIN' | 'ADMIN' }
      | undefined;

    if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
      res.status(401).json({ error: 'Invalid administrator credentials.' });
      return;
    }

    createAdminSession(admin.id, res);
    logAudit(
      { id: admin.id, username: admin.username, email: admin.email, role: admin.role },
      'ADMIN_LOGIN',
      admin.username,
      'Signed in via password'
    );

    res.json({
      admin: {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        role: admin.role,
      },
    });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

apiRouter.post('/admin/google-login', authLimiter, async (req, res) => {
  try {
    const idToken = typeof req.body?.idToken === 'string' ? req.body.idToken : '';
    if (!idToken) {
      res.status(400).json({ error: 'Missing Firebase ID token.' });
      return;
    }

    const decoded = await verifyFirebaseIdToken(idToken);
    if (!decoded.email || !decoded.email_verified) {
      res.status(403).json({ error: 'A verified Google email address is required.' });
      return;
    }

    const normalizedEmail = decoded.email.toLowerCase();
    const admin = db
      .prepare(`
        SELECT id, username, email, role
        FROM administrators
        WHERE lower(email) = ?
        LIMIT 1
      `)
      .get(normalizedEmail) as
      | { id: number; username: string; email: string; role: 'SUPER_ADMIN' | 'ADMIN' }
      | undefined;

    if (!admin) {
      res.status(403).json({
        error: `The Google account ${normalizedEmail} is not authorized as an administrator for this event.`,
      });
      return;
    }

    createAdminSession(admin.id, res);
    logAudit(admin, 'ADMIN_GOOGLE_LOGIN', admin.email, 'Signed in via Google Workspace OAuth');

    res.json({ admin });
  } catch (err) {
    console.error('Google admin login error:', err);
    res.status(401).json({ error: 'Google sign-in verification failed.' });
  }
});

apiRouter.post('/admin/logout', (req, res) => {
  revokeAdminSession(req, res);
  res.json({ ok: true });
});

apiRouter.get('/admin/me', (req, res) => {
  const admin = getAuthenticatedAdmin(req);
  if (!admin) {
    res.status(401).json({ error: 'Not authenticated.' });
    return;
  }
  res.json({ admin });
});

/* ============================================================================
 * PROTECTED ADMINISTRATOR ROUTES
 * ========================================================================== */

apiRouter.get('/admin/overview', requireAdmin, (_req, res) => {
  try {
    const event = getActiveEvent();
    if (!event) {
      res.status(404).json({ error: 'No active event found.' });
      return;
    }

    const counts = db
      .prepare(`
        SELECT
          COUNT(*) as totalRegistrations,
          SUM(CASE WHEN attendance_status = 'CONFIRMED' THEN 1 ELSE 0 END) as confirmedAttendees,
          SUM(CASE WHEN attendance_status = 'PENDING' THEN 1 ELSE 0 END) as pendingConfirmations,
          SUM(CASE WHEN attendance_status = 'DECLINED' THEN 1 ELSE 0 END) as unableToAttend,
          SUM(CASE WHEN gift_exchange_consent = 1 THEN 1 ELSE 0 END) as giftExchangeParticipants,
          SUM(CASE WHEN gift_exchange_consent = 0 THEN 1 ELSE 0 END) as optedOutOfGifting,
          SUM(CASE WHEN attendance_status = 'CONFIRMED' AND gift_exchange_consent = 1 THEN 1 ELSE 0 END) as eligibleForPairing
        FROM participants
        WHERE event_id = ?
      `)
      .get(event.id) as Record<string, number | null>;

    const pairedGivers = db
      .prepare(`
        SELECT COUNT(DISTINCT giver_participant_id) as cnt
        FROM pairings
        WHERE event_id = ?
      `)
      .get(event.id) as { cnt: number };

    const lockedGivers = db
      .prepare(`
        SELECT COUNT(DISTINCT giver_participant_id) as cnt
        FROM pairings
        WHERE event_id = ? AND is_locked = 1
      `)
      .get(event.id) as { cnt: number };

    const withdrawnAlerts = db
      .prepare(`
        SELECT p.id as pairingId, p.is_locked as isLocked,
               g.id as giverId, g.full_name as giverName, g.attendance_status as giverAttendance, g.gift_exchange_consent as giverConsent,
               r.id as recipientId, r.full_name as recipientName, r.attendance_status as recipientAttendance, r.gift_exchange_consent as recipientConsent
        FROM pairings p
        JOIN participants g ON g.id = p.giver_participant_id
        JOIN participants r ON r.id = p.recipient_participant_id
        WHERE p.event_id = ?
          AND (
            g.attendance_status != 'CONFIRMED' OR g.gift_exchange_consent = 0
            OR r.attendance_status != 'CONFIRMED' OR r.gift_exchange_consent = 0
          )
      `)
      .all(event.id);

    const dailyTrend = db
      .prepare(`
        SELECT substr(created_at, 1, 10) as day, COUNT(*) as count
        FROM participants
        WHERE event_id = ?
        GROUP BY substr(created_at, 1, 10)
        ORDER BY day ASC
        LIMIT 14
      `)
      .all(event.id);

    const eligibleCount = Number(counts.eligibleForPairing || 0);
    const pairedCount = Number(pairedGivers.cnt || 0);

    res.json({
      event: {
        id: event.id,
        organizerName: event.organizer_name,
        eventName: event.event_name,
        eventDate: event.event_date,
        venue: event.venue,
        dressCode: event.dress_code,
        giftBudget: event.gift_budget,
        ticketInfo: event.ticket_info,
        contactPhone: event.contact_phone,
        registrationDeadline: event.registration_deadline,
        eventStatus: event.event_status,
        allowAttendanceUpdates: Boolean(event.allow_attendance_updates),
        googleFormId: event.google_form_id,
        googleFormUrl: event.google_form_url,
      },
      stats: {
        totalRegistrations: Number(counts.totalRegistrations || 0),
        confirmedAttendees: Number(counts.confirmedAttendees || 0),
        pendingConfirmations: Number(counts.pendingConfirmations || 0),
        unableToAttend: Number(counts.unableToAttend || 0),
        giftExchangeParticipants: Number(counts.giftExchangeParticipants || 0),
        optedOutOfGifting: Number(counts.optedOutOfGifting || 0),
        eligibleForPairing: eligibleCount,
        successfullyPaired: pairedCount,
        lockedPairings: Number(lockedGivers.cnt || 0),
        unpairedEligible: Math.max(0, eligibleCount - pairedCount),
      },
      withdrawnAlerts,
      dailyTrend,
    });
  } catch (err) {
    console.error('Overview error:', err);
    res.status(500).json({ error: 'Failed to load dashboard overview.' });
  }
});

apiRouter.get('/admin/participants', requireAdmin, (req, res) => {
  try {
    const event = getActiveEvent();
    if (!event) {
      res.status(404).json({ error: 'No active event found.' });
      return;
    }

    const search = cleanText(req.query.search, 120).toLowerCase();
    const attendance = cleanText(req.query.attendance, 20).toUpperCase();
    const consent = cleanText(req.query.consent, 20).toLowerCase();
    const pairing = cleanText(req.query.pairing, 20).toLowerCase();

    const rows = db
      .prepare(`
        SELECT p.id, p.registration_reference, p.full_name, p.phone_number, p.email, p.residence,
               p.ticket_category, p.attendance_status, p.gift_exchange_consent, p.source, p.created_at, p.updated_at,
               pr.id as pairing_id, pr.is_locked as pairing_locked, pr.pairing_mode,
               rec.full_name as assigned_recipient_name
        FROM participants p
        LEFT JOIN pairings pr ON pr.giver_participant_id = p.id AND pr.event_id = p.event_id
        LEFT JOIN participants rec ON rec.id = pr.recipient_participant_id
        WHERE p.event_id = ?
        ORDER BY p.created_at DESC, p.id DESC
      `)
      .all(event.id) as Array<Record<string, unknown>>;

    const mapped = rows
      .map((r) => {
        const isEligible = r.attendance_status === 'CONFIRMED' && r.gift_exchange_consent === 1;
        const pairingStatus = r.pairing_id
          ? r.pairing_locked === 1
            ? 'LOCKED'
            : 'DRAFT'
          : isEligible
            ? 'UNPAIRED'
            : 'INELIGIBLE';

        return {
          id: Number(r.id),
          registrationReference: String(r.registration_reference),
          fullName: String(r.full_name),
          phoneNumber: String(r.phone_number),
          email: r.email ? String(r.email) : null,
          residence: String(r.residence),
          ticketCategory: r.ticket_category === 'ALUMNI' ? 'ALUMNI' : 'STUDENT',
          attendanceStatus: String(r.attendance_status),
          giftExchangeConsent: r.gift_exchange_consent === 1,
          source: String(r.source || 'WEB'),
          pairingStatus,
          pairingMode: r.pairing_mode ? String(r.pairing_mode) : null,
          assignedRecipientName: r.assigned_recipient_name ? String(r.assigned_recipient_name) : null,
          createdAt: String(r.created_at),
          updatedAt: String(r.updated_at),
        };
      })
      .filter((item) => {
        if (search) {
          const hay = `${item.registrationReference} ${item.fullName} ${item.phoneNumber} ${item.email || ''} ${item.residence} ${item.ticketCategory}`.toLowerCase();
          if (!hay.includes(search)) return false;
        }
        if (attendance && attendance !== 'ALL' && item.attendanceStatus !== attendance) return false;
        if (consent === 'yes' && !item.giftExchangeConsent) return false;
        if (consent === 'no' && item.giftExchangeConsent) return false;
        if (pairing && pairing !== 'all' && item.pairingStatus.toLowerCase() !== pairing) return false;
        return true;
      });

    res.json({ participants: mapped });
  } catch (err) {
    console.error('Participants fetch error:', err);
    res.status(500).json({ error: 'Failed to load participants.' });
  }
});

apiRouter.post('/admin/participants', requireAdmin, (req: AdminRequest, res) => {
  try {
    const event = getActiveEvent();
    if (!event) {
      res.status(404).json({ error: 'No active event found.' });
      return;
    }

    const fullName = cleanText(req.body?.fullName, 120);
    const phoneNumber = normalizePhone(req.body?.phoneNumber);
    const email = cleanText(req.body?.email, 254).toLowerCase();
    const residence = cleanText(req.body?.residence, 160);
    const ticketCategory = parseTicketCategory(req.body?.ticketCategory) ?? 'STUDENT';
    const attendanceStatus = parseAttendanceStatus(req.body?.attendanceStatus) || 'PENDING';
    const giftExchangeConsent = parseConsent(req.body?.giftExchangeConsent) ?? true;

    if (!fullName || !phoneNumber || !isValidPhone(phoneNumber) || !residence) {
      res.status(400).json({ error: 'Full name, valid phone number, and residence are required.' });
      return;
    }
    if (email && !isValidEmail(email)) {
      res.status(400).json({ error: 'Invalid email format.' });
      return;
    }

    const dup = db
      .prepare('SELECT id FROM participants WHERE event_id = ? AND phone_number = ?')
      .get(event.id, phoneNumber);
    if (dup) {
      res.status(409).json({ error: 'A participant with this phone number is already registered.' });
      return;
    }

    const accessCode = generateNumericCode(6);
    const accessCodeHash = hashSha256(accessCode);

    const created = withTransaction(() => {
      const ref = generateUniqueReference();
      const result = db
        .prepare(`
          INSERT INTO participants (
            event_id, registration_reference, full_name, phone_number, email, residence,
            ticket_category, attendance_status, gift_exchange_consent, access_code_hash, source
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ADMIN')
        `)
        .run(
          event.id,
          ref,
          fullName,
          phoneNumber,
          email || null,
          residence,
          ticketCategory,
          attendanceStatus,
          giftExchangeConsent ? 1 : 0,
          accessCodeHash
        );
      logAudit(req.admin!, 'ADD_PARTICIPANT', `${ref} (${fullName})`, `Added via Admin Dashboard (${ticketCategory})`);
      return { id: Number(result.lastInsertRowid), registrationReference: ref };
    });

    res.status(201).json({ ...created, personalAccessCode: accessCode });
  } catch (err) {
    console.error('Admin add participant error:', err);
    res.status(500).json({ error: 'Failed to add participant.' });
  }
});

apiRouter.patch('/admin/participants/:id', requireAdmin, (req: AdminRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid participant ID.' });
      return;
    }

    const existing = db.prepare('SELECT * FROM participants WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Participant not found.' });
      return;
    }

    const fullName = req.body?.fullName !== undefined ? cleanText(req.body.fullName, 120) : String(existing.full_name);
    const phoneNumber =
      req.body?.phoneNumber !== undefined ? normalizePhone(req.body.phoneNumber) : String(existing.phone_number);
    const email =
      req.body?.email !== undefined
        ? cleanText(req.body.email, 254).toLowerCase()
        : existing.email
          ? String(existing.email)
          : '';
    const residence = req.body?.residence !== undefined ? cleanText(req.body.residence, 160) : String(existing.residence);
    const ticketCategory =
      req.body?.ticketCategory !== undefined
        ? parseTicketCategory(req.body.ticketCategory)
        : existing.ticket_category === 'ALUMNI'
          ? 'ALUMNI'
          : 'STUDENT';
    const attendanceStatus =
      req.body?.attendanceStatus !== undefined
        ? parseAttendanceStatus(req.body.attendanceStatus)
        : (String(existing.attendance_status) as 'CONFIRMED' | 'PENDING' | 'DECLINED');
    const giftExchangeConsent =
      req.body?.giftExchangeConsent !== undefined
        ? parseConsent(req.body.giftExchangeConsent)
        : existing.gift_exchange_consent === 1;

    if (!fullName || !phoneNumber || !isValidPhone(phoneNumber) || !residence || !ticketCategory || !attendanceStatus || giftExchangeConsent === null) {
      res.status(400).json({ error: 'Invalid participant details supplied.' });
      return;
    }
    if (email && !isValidEmail(email)) {
      res.status(400).json({ error: 'Invalid email address.' });
      return;
    }

    const dup = db
      .prepare('SELECT id FROM participants WHERE event_id = ? AND phone_number = ? AND id != ?')
      .get(Number(existing.event_id), phoneNumber, id);
    if (dup) {
      res.status(409).json({ error: 'Another registration already uses this telephone number.' });
      return;
    }

    db.prepare(`
      UPDATE participants
      SET full_name = ?, phone_number = ?, email = ?, residence = ?,
          ticket_category = ?, attendance_status = ?, gift_exchange_consent = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(fullName, phoneNumber, email || null, residence, ticketCategory, attendanceStatus, giftExchangeConsent ? 1 : 0, id);

    logAudit(
      req.admin!,
      'UPDATE_PARTICIPANT',
      `${String(existing.registration_reference)} (${fullName})`,
      `Ticket=${ticketCategory}, Attendance=${attendanceStatus}, Consent=${giftExchangeConsent}`
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('Update participant error:', err);
    res.status(500).json({ error: 'Failed to update participant.' });
  }
});

apiRouter.delete('/admin/participants/:id', requireAdmin, (req: AdminRequest, res) => {
  try {
    const id = Number(req.params.id);
    const existing = db
      .prepare('SELECT id, event_id, registration_reference, full_name FROM participants WHERE id = ?')
      .get(id) as { id: number; event_id: number; registration_reference: string; full_name: string } | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Participant not found.' });
      return;
    }

    const lockedLink = db
      .prepare(`
        SELECT id FROM pairings
        WHERE event_id = ? AND is_locked = 1 AND (giver_participant_id = ? OR recipient_participant_id = ?)
      `)
      .get(existing.event_id, id, id);

    if (lockedLink) {
      res.status(409).json({
        error: 'This participant is part of a locked gift pairing. Unlink their pairing in Gift Pairings before deleting.',
      });
      return;
    }

    db.prepare('DELETE FROM participants WHERE id = ?').run(id);
    logAudit(
      req.admin!,
      'DELETE_PARTICIPANT',
      `${existing.registration_reference} (${existing.full_name})`,
      'Removed duplicate or invalid registration'
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('Delete participant error:', err);
    res.status(500).json({ error: 'Failed to delete participant.' });
  }
});

apiRouter.post('/admin/participants/:id/issue-otp', requireAdmin, (req: AdminRequest, res) => {
  try {
    const id = Number(req.params.id);
    const participant = db
      .prepare('SELECT id, registration_reference, full_name, phone_number FROM participants WHERE id = ?')
      .get(id) as
      | { id: number; registration_reference: string; full_name: string; phone_number: string }
      | undefined;

    if (!participant) {
      res.status(404).json({ error: 'Participant not found.' });
      return;
    }

    const otp = generateNumericCode(6);
    const otpHash = hashSha256(otp);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour for admin-dispatched codes

    db.prepare(`
      UPDATE participants
      SET verification_code_hash = ?, verification_code_expires_at = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(otpHash, expiresAt, participant.id);

    logAudit(
      req.admin!,
      'ISSUE_ACCESS_OTP',
      `${participant.registration_reference} (${participant.full_name})`,
      'Issued 6-digit verification code for participant retrieval'
    );

    res.json({
      code: otp,
      expiresInMinutes: 60,
      registrationReference: participant.registration_reference,
      phoneNumber: participant.phone_number,
      fullName: participant.full_name,
    });
  } catch (err) {
    console.error('Issue OTP error:', err);
    res.status(500).json({ error: 'Failed to generate verification code.' });
  }
});

apiRouter.post('/admin/seed-sample', requireAdmin, (req: AdminRequest, res) => {
  try {
    const event = getActiveEvent();
    if (!event) {
      res.status(404).json({ error: 'No active event found.' });
      return;
    }

    const sampleGuests = [
      { fullName: 'Arnible Ssemogerere', phone: '0772400101', email: 'arnible.s@example.com', residence: 'Makindye, Kampala', ticket: 'STUDENT', attendance: 'CONFIRMED', consent: true },
      { fullName: 'Sarah Namukasa', phone: '0772400102', email: 'sarah.n@example.com', residence: 'Nsambya, Kampala', ticket: 'STUDENT', attendance: 'CONFIRMED', consent: true },
      { fullName: 'John Kato', phone: '0772400103', email: 'john.k@example.com', residence: 'Kabalagala, Kampala', ticket: 'ALUMNI', attendance: 'CONFIRMED', consent: true },
      { fullName: 'Peter Mugisha', phone: '0772400104', email: 'peter.m@example.com', residence: 'Kansanga, Kampala', ticket: 'STUDENT', attendance: 'CONFIRMED', consent: true },
      { fullName: 'Clara Nabwire', phone: '0772400105', email: 'clara.n@example.com', residence: 'Muyenga, Kampala', ticket: 'ALUMNI', attendance: 'CONFIRMED', consent: true },
      { fullName: 'David Wasswa', phone: '0772400106', email: 'david.w@example.com', residence: 'Ggaba, Kampala', ticket: 'STUDENT', attendance: 'CONFIRMED', consent: true },
      { fullName: 'Elena Nakato', phone: '0772400107', email: 'elena.n@example.com', residence: 'Bunga, Kampala', ticket: 'ALUMNI', attendance: 'CONFIRMED', consent: true },
      { fullName: 'Marcus Okello', phone: '0772400108', email: 'marcus.o@example.com', residence: 'Munyonyo, Kampala', ticket: 'STUDENT', attendance: 'CONFIRMED', consent: true },
      { fullName: 'Nadia Kirabo', phone: '0772400109', email: 'nadia.k@example.com', residence: 'Lukuli, Makindye', ticket: 'STUDENT', attendance: 'PENDING', consent: true },
      { fullName: 'Thomas Tumusiime', phone: '0772400110', email: 'thomas.t@example.com', residence: 'Salama Road, Kampala', ticket: 'ALUMNI', attendance: 'PENDING', consent: false },
      { fullName: 'Beatrice Apio', phone: '0772400111', email: 'beatrice.a@example.com', residence: 'Konge, Makindye', ticket: 'STUDENT', attendance: 'CONFIRMED', consent: false },
      { fullName: 'Samuel Lule', phone: '0772400112', email: 'samuel.l@example.com', residence: 'Katwe, Kampala', ticket: 'ALUMNI', attendance: 'DECLINED', consent: false },
    ];

    let inserted = 0;
    withTransaction(() => {
      const insertStmt = db.prepare(`
        INSERT OR IGNORE INTO participants (
          event_id, registration_reference, full_name, phone_number, email, residence,
          ticket_category, attendance_status, gift_exchange_consent, access_code_hash, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SEED')
      `);

      for (const guest of sampleGuests) {
        const exists = db
          .prepare('SELECT id FROM participants WHERE event_id = ? AND phone_number = ?')
          .get(event.id, guest.phone);
        if (!exists) {
          const ref = generateUniqueReference();
          const codeHash = hashSha256('123456');
          insertStmt.run(
            event.id,
            ref,
            guest.fullName,
            guest.phone,
            guest.email,
            guest.residence,
            guest.ticket,
            guest.attendance,
            guest.consent ? 1 : 0,
            codeHash
          );
          inserted += 1;
        }
      }

      logAudit(req.admin!, 'SEED_SAMPLE_COHORT', `${inserted} guest(s)`, 'Loaded sample cohort into database');
    });

    res.json({ inserted, message: `Added ${inserted} sample participant(s) to the database.` });
  } catch (err) {
    console.error('Seed sample error:', err);
    res.status(500).json({ error: 'Failed to seed sample guests.' });
  }
});

/* ============================================================================
 * PAIRING ENGINE ROUTES
 * ========================================================================== */

apiRouter.get('/admin/pairings', requireAdmin, (req, res) => {
  try {
    const event = getActiveEvent();
    if (!event) {
      res.status(404).json({ error: 'No active event found.' });
      return;
    }

    const requestedMode = req.query.mode === 'MUTUAL' ? 'MUTUAL' : 'SECRET';
    const previewMutual = previewPairingPlan(event.id, 'MUTUAL');
    const previewSecret = previewPairingPlan(event.id, 'SECRET');

    const batches = db
      .prepare(`
        SELECT id, pairing_mode, total_eligible, total_paired, total_queued, status, created_at, locked_at
        FROM pairing_batches
        WHERE event_id = ?
        ORDER BY id DESC
      `)
      .all(event.id);

    const pairings = db
      .prepare(`
        SELECT p.id, p.pairing_batch_id, p.pairing_mode, p.is_locked, p.created_at, p.locked_at,
               g.id as giver_id, g.registration_reference as giver_ref, g.full_name as giver_name,
               g.attendance_status as giver_attendance, g.gift_exchange_consent as giver_consent,
               r.id as recipient_id, r.registration_reference as recipient_ref, r.full_name as recipient_name,
               r.attendance_status as recipient_attendance, r.gift_exchange_consent as recipient_consent
        FROM pairings p
        JOIN participants g ON g.id = p.giver_participant_id
        JOIN participants r ON r.id = p.recipient_participant_id
        WHERE p.event_id = ?
        ORDER BY p.is_locked DESC, p.id ASC
      `)
      .all(event.id);

    const unpairedEligible = db
      .prepare(`
        SELECT p.id, p.registration_reference, p.full_name, p.residence, p.phone_number
        FROM participants p
        WHERE p.event_id = ?
          AND p.attendance_status = 'CONFIRMED'
          AND p.gift_exchange_consent = 1
          AND p.id NOT IN (SELECT giver_participant_id FROM pairings WHERE event_id = ?)
          AND p.id NOT IN (SELECT recipient_participant_id FROM pairings WHERE event_id = ?)
        ORDER BY p.id ASC
      `)
      .all(event.id, event.id, event.id);

    res.json({
      preview: requestedMode === 'MUTUAL' ? previewMutual : previewSecret,
      previews: {
        MUTUAL: previewMutual,
        SECRET: previewSecret,
      },
      batches,
      pairings,
      unpairedEligible,
    });
  } catch (err) {
    console.error('Load pairings error:', err);
    res.status(500).json({ error: 'Failed to load pairings.' });
  }
});

apiRouter.post('/admin/pairings/generate', requireAdmin, (req: AdminRequest, res) => {
  try {
    const event = getActiveEvent();
    if (!event) {
      res.status(404).json({ error: 'No active event found.' });
      return;
    }

    const mode: PairingMode = req.body?.mode === 'MUTUAL' ? 'MUTUAL' : 'SECRET';
    const result = generatePairingBatch(event.id, mode, req.admin!);
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to generate pairings.';
    res.status(400).json({ error: message });
  }
});

apiRouter.post('/admin/pairings/:batchId/lock', requireAdmin, (req: AdminRequest, res) => {
  try {
    const event = getActiveEvent();
    if (!event) {
      res.status(404).json({ error: 'No active event found.' });
      return;
    }
    const batchId = Number(req.params.batchId);
    const result = lockPairingBatch(event.id, batchId, req.admin!);
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to lock pairing batch.';
    res.status(400).json({ error: message });
  }
});

apiRouter.delete('/admin/pairings/:batchId', requireAdmin, (req: AdminRequest, res) => {
  try {
    const event = getActiveEvent();
    if (!event) {
      res.status(404).json({ error: 'No active event found.' });
      return;
    }
    const batchId = Number(req.params.batchId);
    const result = discardDraftBatch(event.id, batchId, req.admin!);
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to discard draft batch.';
    res.status(400).json({ error: message });
  }
});

apiRouter.post('/admin/pairings/reassign', requireAdmin, (req: AdminRequest, res) => {
  try {
    const event = getActiveEvent();
    if (!event) {
      res.status(404).json({ error: 'No active event found.' });
      return;
    }
    const result = reassignPairings(event.id, req.body, req.admin!);
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Reassignment failed.';
    res.status(400).json({ error: message });
  }
});

/* ============================================================================
 * EXPORT ROUTES (CSV & Excel SpreadsheetML)
 * ========================================================================== */

apiRouter.get('/admin/export/participants', requireAdmin, (req: AdminRequest, res) => {
  try {
    const event = getActiveEvent();
    if (!event) {
      res.status(404).json({ error: 'No active event found.' });
      return;
    }

    const format = req.query.format === 'xls' ? 'xls' : 'csv';
    const rows = db
      .prepare(`
        SELECT p.registration_reference, p.full_name, p.phone_number, p.email, p.residence,
               p.ticket_category, p.attendance_status, p.gift_exchange_consent, p.source, p.created_at,
               pr.is_locked, rec.full_name as assigned_recipient_name
        FROM participants p
        LEFT JOIN pairings pr ON pr.giver_participant_id = p.id AND pr.event_id = p.event_id
        LEFT JOIN participants rec ON rec.id = pr.recipient_participant_id
        WHERE p.event_id = ?
        ORDER BY p.id ASC
      `)
      .all(event.id) as Array<Record<string, unknown>>;

    const headers = [
      'Registration ID',
      'Full Name',
      'Phone Number',
      'Email',
      'Residence',
      'Ticket Category',
      'Attendance Status',
      'Gift Exchange Consent',
      'Pairing Status',
      'Assigned Recipient',
      'Source',
      'Registration Date',
    ];

    const mappedRows = rows.map((r) => [
      String(r.registration_reference),
      String(r.full_name),
      String(r.phone_number),
      r.email ? String(r.email) : '',
      String(r.residence),
      r.ticket_category === 'ALUMNI' ? 'Alumni (UGX 70,000)' : 'Student (UGX 50,000)',
      String(r.attendance_status),
      r.gift_exchange_consent === 1 ? 'Yes' : 'No',
      r.assigned_recipient_name ? (r.is_locked === 1 ? 'Locked' : 'Draft') : 'Unpaired',
      r.assigned_recipient_name ? String(r.assigned_recipient_name) : '',
      String(r.source || 'WEB'),
      String(r.created_at),
    ]);

    logAudit(req.admin!, 'EXPORT_PARTICIPANTS', `Format=${format.toUpperCase()}`, `Exported ${mappedRows.length} rows`);

    if (format === 'xls') {
      const xmlRows = [headers, ...mappedRows]
        .map(
          (cols) =>
            `<Row>${cols
              .map((c) => `<Cell><Data ss:Type="String">${escapeXml(c)}</Data></Cell>`)
              .join('')}</Row>`
        )
        .join('\n');

      const workbook = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Participants">
  <Table>
   ${xmlRows}
  </Table>
 </Worksheet>
</Workbook>`;

      res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="dinner-pair-participants.xls"');
      res.send(workbook);
      return;
    }

    const csv =
      '\uFEFF' +
      [headers, ...mappedRows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="dinner-pair-participants.csv"');
    res.send(csv);
  } catch (err) {
    console.error('Export participants error:', err);
    res.status(500).json({ error: 'Failed to export participant records.' });
  }
});

apiRouter.get('/admin/export/pairings', requireAdmin, (req: AdminRequest, res) => {
  try {
    const event = getActiveEvent();
    if (!event) {
      res.status(404).json({ error: 'No active event found.' });
      return;
    }

    const format = req.query.format === 'xls' ? 'xls' : 'csv';
    const rows = db
      .prepare(`
        SELECT p.id, p.pairing_batch_id, p.pairing_mode, p.is_locked, p.created_at, p.locked_at,
               g.registration_reference as giver_ref, g.full_name as giver_name, g.phone_number as giver_phone,
               r.registration_reference as recipient_ref, r.full_name as recipient_name, r.phone_number as recipient_phone
        FROM pairings p
        JOIN participants g ON g.id = p.giver_participant_id
        JOIN participants r ON r.id = p.recipient_participant_id
        WHERE p.event_id = ?
        ORDER BY p.id ASC
      `)
      .all(event.id) as Array<Record<string, unknown>>;

    const headers = [
      'Pairing ID',
      'Batch ID',
      'Mode',
      'Status',
      'Giver Ref',
      'Giver Name',
      'Giver Phone',
      'Recipient Ref',
      'Recipient Name',
      'Recipient Phone',
      'Locked At',
    ];

    const mappedRows = rows.map((r) => [
      String(r.id),
      String(r.pairing_batch_id),
      String(r.pairing_mode),
      r.is_locked === 1 ? 'LOCKED' : 'DRAFT',
      String(r.giver_ref),
      String(r.giver_name),
      String(r.giver_phone),
      String(r.recipient_ref),
      String(r.recipient_name),
      String(r.recipient_phone),
      r.locked_at ? String(r.locked_at) : '',
    ]);

    logAudit(req.admin!, 'EXPORT_PAIRINGS', `Format=${format.toUpperCase()}`, `Exported ${mappedRows.length} pairings`);

    if (format === 'xls') {
      const xmlRows = [headers, ...mappedRows]
        .map(
          (cols) =>
            `<Row>${cols
              .map((c) => `<Cell><Data ss:Type="String">${escapeXml(c)}</Data></Cell>`)
              .join('')}</Row>`
        )
        .join('\n');

      const workbook = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Gift Pairings">
  <Table>
   ${xmlRows}
  </Table>
 </Worksheet>
</Workbook>`;

      res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="dinner-pair-report.xls"');
      res.send(workbook);
      return;
    }

    const csv =
      '\uFEFF' +
      [headers, ...mappedRows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="dinner-pair-report.csv"');
    res.send(csv);
  } catch (err) {
    console.error('Export pairings error:', err);
    res.status(500).json({ error: 'Failed to export pairing report.' });
  }
});

/* ============================================================================
 * EVENT SETTINGS & GOOGLE FORMS INTEGRATION ROUTES
 * ========================================================================== */

apiRouter.put('/admin/event', requireAdmin, (req: AdminRequest, res) => {
  try {
    const event = getActiveEvent();
    if (!event) {
      res.status(404).json({ error: 'No active event found.' });
      return;
    }

    const organizerName = cleanText(req.body?.organizerName, 140) || event.organizer_name;
    const eventName = cleanText(req.body?.eventName, 160) || event.event_name;
    const eventDate = cleanText(req.body?.eventDate, 80) || event.event_date;
    const venue = cleanText(req.body?.venue, 200) || event.venue;
    const dressCode = cleanText(req.body?.dressCode, 140) || event.dress_code;
    const giftBudget = cleanText(req.body?.giftBudget, 140) || event.gift_budget;
    const ticketInfo = cleanText(req.body?.ticketInfo, 200) || event.ticket_info;
    const contactPhone = cleanText(req.body?.contactPhone, 40) || event.contact_phone;
    const registrationDeadline = cleanText(req.body?.registrationDeadline, 80) || event.registration_deadline;
    const eventStatus = ['OPEN', 'CLOSED', 'COMPLETED'].includes(req.body?.eventStatus)
      ? req.body.eventStatus
      : event.event_status;
    const allowAttendanceUpdates =
      req.body?.allowAttendanceUpdates !== undefined ? (req.body.allowAttendanceUpdates ? 1 : 0) : event.allow_attendance_updates;
    const googleFormId =
      req.body?.googleFormId !== undefined ? cleanText(req.body.googleFormId, 160) || null : event.google_form_id;
    const googleFormUrl =
      req.body?.googleFormUrl !== undefined ? cleanText(req.body.googleFormUrl, 300) || null : event.google_form_url;

    db.prepare(`
      UPDATE events
      SET organizer_name = ?, event_name = ?, event_date = ?, venue = ?, dress_code = ?, gift_budget = ?,
          ticket_info = ?, contact_phone = ?, registration_deadline = ?, event_status = ?, allow_attendance_updates = ?,
          google_form_id = ?, google_form_url = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      organizerName,
      eventName,
      eventDate,
      venue,
      dressCode,
      giftBudget,
      ticketInfo,
      contactPhone,
      registrationDeadline,
      eventStatus,
      allowAttendanceUpdates,
      googleFormId,
      googleFormUrl,
      event.id
    );

    logAudit(req.admin!, 'UPDATE_EVENT_SETTINGS', eventName, `Status=${eventStatus}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('Update event error:', err);
    res.status(500).json({ error: 'Failed to save event settings.' });
  }
});

apiRouter.post('/admin/google-forms/create', requireAdmin, async (req: AdminRequest, res) => {
  try {
    const event = getActiveEvent();
    if (!event) {
      res.status(404).json({ error: 'No active event found.' });
      return;
    }

    const googleToken = req.headers['x-google-access-token'];
    if (typeof googleToken !== 'string' || !googleToken.trim()) {
      res.status(401).json({ error: 'Google Forms authorization token is required. Sign in with Google first.' });
      return;
    }

    // 1. Create the Google Form
    const createRes = await fetch('https://forms.googleapis.com/v1/forms', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${googleToken.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        info: {
          title: `${event.event_name} — Dinner Pair Registration`,
          documentTitle: `${event.event_name} Registration`,
        },
      }),
    });

    const createdForm = (await createRes.json()) as {
      formId?: string;
      responderUri?: string;
      error?: { message?: string };
    };

    if (!createRes.ok || !createdForm.formId) {
      res.status(createRes.status || 502).json({
        error: createdForm.error?.message || 'Google Forms API rejected form creation.',
      });
      return;
    }

    const safeFormId = encodeURIComponent(createdForm.formId.trim());

    // 2. Populate structured Dinner Pair registration questions
    const batchRes = await fetch(`https://forms.googleapis.com/v1/forms/${safeFormId}:batchUpdate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${googleToken.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            updateFormInfo: {
              info: {
                description: `${event.organizer_name} presents ${event.event_name}\nVenue: ${event.venue}\nTickets: ${event.ticket_info}\nInquiries / RSVP: ${event.contact_phone}\nGift Budget: ${event.gift_budget}`,
              },
              updateMask: 'description',
            },
          },
          {
            createItem: {
              item: {
                title: 'Full Name',
                questionItem: { question: { required: true, textQuestion: { paragraph: false } } },
              },
              location: { index: 0 },
            },
          },
          {
            createItem: {
              item: {
                title: 'Telephone / WhatsApp Number',
                questionItem: { question: { required: true, textQuestion: { paragraph: false } } },
              },
              location: { index: 1 },
            },
          },
          {
            createItem: {
              item: {
                title: 'Email Address (Optional)',
                questionItem: { question: { required: false, textQuestion: { paragraph: false } } },
              },
              location: { index: 2 },
            },
          },
          {
            createItem: {
              item: {
                title: 'Residence / Location',
                questionItem: { question: { required: true, textQuestion: { paragraph: false } } },
              },
              location: { index: 3 },
            },
          },
          {
            createItem: {
              item: {
                title: 'Ticket Category',
                questionItem: {
                  question: {
                    required: true,
                    choiceQuestion: {
                      type: 'RADIO',
                      options: [
                        { value: 'Student Ticket — UGX 50,000' },
                        { value: 'Alumni Ticket — UGX 70,000' },
                      ],
                    },
                  },
                },
              },
              location: { index: 4 },
            },
          },
          {
            createItem: {
              item: {
                title: 'Dinner Attendance Confirmation',
                questionItem: {
                  question: {
                    required: true,
                    choiceQuestion: {
                      type: 'RADIO',
                      options: [
                        { value: 'Yes, I confirm my attendance.' },
                        { value: 'Not yet confirmed.' },
                        { value: 'No, I will not attend.' },
                      ],
                    },
                  },
                },
              },
              location: { index: 5 },
            },
          },
          {
            createItem: {
              item: {
                title: 'Gift Exchange Participation Consent',
                questionItem: {
                  question: {
                    required: true,
                    choiceQuestion: {
                      type: 'RADIO',
                      options: [
                        { value: 'Yes, I agree to participate.' },
                        { value: 'No, I do not wish to participate.' },
                      ],
                    },
                  },
                },
              },
              location: { index: 6 },
            },
          },
        ],
      }),
    });

    if (!batchRes.ok) {
      const errData = (await batchRes.json().catch(() => ({}))) as { error?: { message?: string } };
      res.status(batchRes.status).json({
        error: errData.error?.message || 'Created Google Form, but failed to add questions.',
      });
      return;
    }

    db.prepare(`
      UPDATE events
      SET google_form_id = ?, google_form_url = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(createdForm.formId, createdForm.responderUri || null, event.id);

    logAudit(
      req.admin!,
      'CREATE_GOOGLE_FORM',
      createdForm.formId,
      `Created and linked Google Form for ${event.event_name}`
    );

    res.json({
      formId: createdForm.formId,
      responderUri: createdForm.responderUri,
    });
  } catch (err) {
    console.error('Google Forms create error:', err);
    res.status(500).json({ error: 'Failed to create Google Form.' });
  }
});

apiRouter.post('/admin/google-forms/sync', requireAdmin, async (req: AdminRequest, res) => {
  try {
    const event = getActiveEvent();
    if (!event) {
      res.status(404).json({ error: 'No active event found.' });
      return;
    }

    const googleToken = req.headers['x-google-access-token'];
    if (typeof googleToken !== 'string' || !googleToken.trim()) {
      res.status(401).json({ error: 'Google Forms authorization token is required. Sign in with Google first.' });
      return;
    }

    const rawFormId = cleanText(req.body?.formId, 240) || event.google_form_id || '';
    // Allow pasting full Google Form URL (extract /d/FORM_ID/)
    const urlMatch = rawFormId.match(/\/forms\/d\/(?:e\/)?([a-zA-Z0-9_-]+)/);
    const formId = urlMatch ? urlMatch[1] : rawFormId;

    if (!formId) {
      res.status(400).json({ error: 'Provide a Google Form ID or URL to sync responses.' });
      return;
    }

    const safeFormId = encodeURIComponent(formId.trim());
    const authHeaders = { Authorization: `Bearer ${googleToken.trim()}` };

    const [formRes, respRes] = await Promise.all([
      fetch(`https://forms.googleapis.com/v1/forms/${safeFormId}`, { headers: authHeaders }),
      fetch(`https://forms.googleapis.com/v1/forms/${safeFormId}/responses`, { headers: authHeaders }),
    ]);

    const formData = (await formRes.json()) as {
      formId?: string;
      responderUri?: string;
      items?: Array<{
        title?: string;
        questionItem?: { question?: { questionId?: string } };
      }>;
      error?: { message?: string };
    };

    if (!formRes.ok) {
      res.status(formRes.status).json({
        error: formData.error?.message || 'Unable to read the specified Google Form.',
      });
      return;
    }

    const respData = (await respRes.json()) as {
      responses?: Array<{
        responseId?: string;
        answers?: Record<
          string,
          { textAnswers?: { answers?: Array<{ value?: string }> } }
        >;
      }>;
      error?: { message?: string };
    };

    if (!respRes.ok) {
      res.status(respRes.status).json({
        error: respData.error?.message || 'Unable to read Google Form responses.',
      });
      return;
    }

    // Build questionId -> field mapping
    const qMap: Record<string, string> = {};
    for (const item of formData.items || []) {
      const qId = item.questionItem?.question?.questionId;
      const title = (item.title || '').toLowerCase();
      if (!qId) continue;
      if (title.includes('name')) qMap[qId] = 'fullName';
      else if (title.includes('phone') || title.includes('telephone') || title.includes('whatsapp')) qMap[qId] = 'phoneNumber';
      else if (title.includes('email')) qMap[qId] = 'email';
      else if (title.includes('residence') || title.includes('location') || title.includes('address')) qMap[qId] = 'residence';
      else if (title.includes('ticket') || title.includes('category')) qMap[qId] = 'ticketCategory';
      else if (title.includes('attendance')) qMap[qId] = 'attendanceStatus';
      else if (title.includes('gift') || title.includes('consent')) qMap[qId] = 'giftExchangeConsent';
    }

    const responses = respData.responses || [];
    let importedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    withTransaction(() => {
      db.prepare(`
        UPDATE events
        SET google_form_id = ?, google_form_url = COALESCE(?, google_form_url), updated_at = datetime('now')
        WHERE id = ?
      `).run(formId, formData.responderUri || null, event.id);

      for (const response of responses) {
        const record: Record<string, string> = {};
        for (const [qId, answerObj] of Object.entries(response.answers || {})) {
          const field = qMap[qId];
          const val = answerObj?.textAnswers?.answers?.[0]?.value;
          if (field && val) {
            record[field] = val;
          }
        }

        const fullName = cleanText(record.fullName, 120);
        const phoneNumber = normalizePhone(record.phoneNumber);
        const email = cleanText(record.email, 254).toLowerCase();
        const residence = cleanText(record.residence, 160) || 'Not specified';
        const ticketCategory = parseTicketCategory(record.ticketCategory) ?? 'STUDENT';
        const attendanceStatus = parseAttendanceStatus(record.attendanceStatus) || 'PENDING';
        const giftConsent = parseConsent(record.giftExchangeConsent) ?? false;

        if (!fullName || !phoneNumber || !isValidPhone(phoneNumber)) {
          skippedCount += 1;
          continue;
        }

        const existing = db
          .prepare('SELECT id FROM participants WHERE event_id = ? AND phone_number = ?')
          .get(event.id, phoneNumber) as { id: number } | undefined;

        if (existing) {
          db.prepare(`
            UPDATE participants
            SET full_name = ?, email = COALESCE(?, email), residence = ?,
                ticket_category = ?, attendance_status = ?, gift_exchange_consent = ?, updated_at = datetime('now')
            WHERE id = ?
          `).run(fullName, email || null, residence, ticketCategory, attendanceStatus, giftConsent ? 1 : 0, existing.id);
          updatedCount += 1;
        } else {
          const ref = generateUniqueReference();
          const accessCodeHash = hashSha256(generateNumericCode(6));
          db.prepare(`
            INSERT INTO participants (
              event_id, registration_reference, full_name, phone_number, email, residence,
              ticket_category, attendance_status, gift_exchange_consent, access_code_hash, source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'GOOGLE_FORM')
          `).run(
            event.id,
            ref,
            fullName,
            phoneNumber,
            email && isValidEmail(email) ? email : null,
            residence,
            ticketCategory,
            attendanceStatus,
            giftConsent ? 1 : 0,
            accessCodeHash
          );
          importedCount += 1;
        }
      }

      logAudit(
        req.admin!,
        'SYNC_GOOGLE_FORM',
        formId,
        `Imported=${importedCount}, Updated=${updatedCount}, Skipped=${skippedCount}`
      );
    });

    res.json({
      formId,
      responderUri: formData.responderUri || event.google_form_url,
      totalResponses: responses.length,
      importedCount,
      updatedCount,
      skippedCount,
    });
  } catch (err) {
    console.error('Google Forms sync error:', err);
    res.status(500).json({ error: 'Failed to sync Google Form responses.' });
  }
});

/* ============================================================================
 * ADMINISTRATOR SETTINGS & AUDIT LOGS
 * ========================================================================== */

apiRouter.get('/admin/settings', requireAdmin, (_req, res) => {
  try {
    const administrators = db
      .prepare('SELECT id, username, email, role, created_at FROM administrators ORDER BY id ASC')
      .all();

    const auditLogs = db
      .prepare('SELECT id, administrator_label, action, affected_record, details, timestamp FROM audit_logs ORDER BY id DESC LIMIT 100')
      .all();

    res.json({ administrators, auditLogs });
  } catch (err) {
    console.error('Admin settings load error:', err);
    res.status(500).json({ error: 'Failed to load administrator settings.' });
  }
});

apiRouter.post('/admin/administrators', requireAdmin, (req: AdminRequest, res) => {
  try {
    if (req.admin?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Only Super Administrators can add administrator accounts.' });
      return;
    }

    const username = cleanText(req.body?.username, 60);
    const email = cleanText(req.body?.email, 254).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const role = req.body?.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'ADMIN';

    if (!username || !email || !isValidEmail(email) || password.length < 8) {
      res.status(400).json({ error: 'Username, valid email, and password (min 8 chars) are required.' });
      return;
    }

    const dup = db
      .prepare('SELECT id FROM administrators WHERE lower(username) = ? OR lower(email) = ?')
      .get(username.toLowerCase(), email);
    if (dup) {
      res.status(409).json({ error: 'Username or email already exists.' });
      return;
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const result = db
      .prepare('INSERT INTO administrators (username, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(username, email, passwordHash, role);

    logAudit(req.admin!, 'CREATE_ADMIN', `${username} (${email})`, `Role=${role}`);
    res.status(201).json({ id: Number(result.lastInsertRowid), username, email, role });
  } catch (err) {
    console.error('Create admin error:', err);
    res.status(500).json({ error: 'Failed to create administrator.' });
  }
});

apiRouter.delete('/admin/administrators/:id', requireAdmin, (req: AdminRequest, res) => {
  try {
    if (req.admin?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Only Super Administrators can remove administrator accounts.' });
      return;
    }

    const id = Number(req.params.id);
    if (id === req.admin.id) {
      res.status(400).json({ error: 'You cannot delete your own active administrator account.' });
      return;
    }

    const target = db.prepare('SELECT id, username, email FROM administrators WHERE id = ?').get(id) as
      | { id: number; username: string; email: string }
      | undefined;
    if (!target) {
      res.status(404).json({ error: 'Administrator not found.' });
      return;
    }

    db.prepare('DELETE FROM administrators WHERE id = ?').run(id);
    logAudit(req.admin!, 'DELETE_ADMIN', `${target.username} (${target.email})`, 'Removed administrator');
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete admin error:', err);
    res.status(500).json({ error: 'Failed to delete administrator.' });
  }
});

apiRouter.post('/admin/change-password', requireAdmin, (req: AdminRequest, res) => {
  try {
    const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

    if (newPassword.length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters long.' });
      return;
    }

    const row = db
      .prepare('SELECT password_hash FROM administrators WHERE id = ?')
      .get(req.admin!.id) as { password_hash: string } | undefined;

    if (!row || !bcrypt.compareSync(currentPassword, row.password_hash)) {
      res.status(401).json({ error: 'Current password is incorrect.' });
      return;
    }

    const newHash = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE administrators SET password_hash = ? WHERE id = ?').run(newHash, req.admin!.id);
    logAudit(req.admin!, 'CHANGE_PASSWORD', req.admin!.username, 'Updated administrator password');

    res.json({ ok: true });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Failed to change password.' });
  }
});
