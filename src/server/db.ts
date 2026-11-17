import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';

const dbPath = path.resolve(process.cwd(), process.env.DB_PATH || './data/dinner_pair.sqlite');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new DatabaseSync(dbPath);

// Configure durability and relational integrity
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

// Initialize relational schema
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organizer_name TEXT NOT NULL DEFAULT 'Manifest Association',
    event_name TEXT NOT NULL,
    event_date TEXT NOT NULL,
    venue TEXT NOT NULL,
    dress_code TEXT DEFAULT 'Evening Elegant · Black & Gold',
    gift_budget TEXT DEFAULT 'UGX 30,000 – UGX 50,000 Wrapped Gift',
    ticket_info TEXT DEFAULT 'Student Tickets: UGX 50,000 · Alumni Tickets: UGX 70,000',
    contact_phone TEXT DEFAULT '0771004906',
    registration_deadline TEXT NOT NULL,
    event_status TEXT NOT NULL DEFAULT 'OPEN' CHECK (event_status IN ('OPEN', 'CLOSED', 'COMPLETED')),
    allow_attendance_updates INTEGER NOT NULL DEFAULT 1,
    google_form_id TEXT,
    google_form_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    registration_reference TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    email TEXT,
    residence TEXT NOT NULL,
    ticket_category TEXT NOT NULL DEFAULT 'STUDENT' CHECK (ticket_category IN ('STUDENT', 'ALUMNI')),
    attendance_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (attendance_status IN ('CONFIRMED', 'PENDING', 'DECLINED')),
    gift_exchange_consent INTEGER NOT NULL DEFAULT 0 CHECK (gift_exchange_consent IN (0, 1)),
    access_code_hash TEXT NOT NULL,
    verification_code_hash TEXT,
    verification_code_expires_at TEXT,
    source TEXT NOT NULL DEFAULT 'WEB',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(event_id, phone_number)
  );

  CREATE INDEX IF NOT EXISTS idx_participants_event_eligibility
    ON participants(event_id, attendance_status, gift_exchange_consent);
  CREATE INDEX IF NOT EXISTS idx_participants_reference
    ON participants(registration_reference);

  CREATE TABLE IF NOT EXISTS pairing_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    pairing_mode TEXT NOT NULL CHECK (pairing_mode IN ('MUTUAL', 'SECRET')),
    total_eligible INTEGER NOT NULL,
    total_paired INTEGER NOT NULL DEFAULT 0,
    total_queued INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'CONFIRMED', 'LOCKED')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    locked_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_pairing_batches_event_status
    ON pairing_batches(event_id, status);

  CREATE TABLE IF NOT EXISTS pairings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pairing_batch_id INTEGER NOT NULL REFERENCES pairing_batches(id) ON DELETE CASCADE,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    giver_participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    recipient_participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    pairing_mode TEXT NOT NULL CHECK (pairing_mode IN ('MUTUAL', 'SECRET')),
    is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    locked_at TEXT,
    CHECK (giver_participant_id != recipient_participant_id),
    UNIQUE(event_id, giver_participant_id),
    UNIQUE(event_id, recipient_participant_id)
  );

  CREATE INDEX IF NOT EXISTS idx_pairings_batch ON pairings(pairing_batch_id);

  CREATE TABLE IF NOT EXISTS administrators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'ADMIN' CHECK (role IN ('SUPER_ADMIN', 'ADMIN')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS admin_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER NOT NULL REFERENCES administrators(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    administrator_id INTEGER REFERENCES administrators(id) ON DELETE SET NULL,
    administrator_label TEXT NOT NULL,
    action TEXT NOT NULL,
    affected_record TEXT NOT NULL,
    details TEXT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
`);

function ensureColumnExists(tableName: string, columnName: string, alterSql: string): void {
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === columnName)) {
    db.exec(alterSql);
  }
}

ensureColumnExists(
  'events',
  'organizer_name',
  `ALTER TABLE events ADD COLUMN organizer_name TEXT NOT NULL DEFAULT 'Manifest Association'`
);
ensureColumnExists(
  'events',
  'ticket_info',
  `ALTER TABLE events ADD COLUMN ticket_info TEXT DEFAULT 'Student Tickets: UGX 50,000 · Alumni Tickets: UGX 70,000'`
);
ensureColumnExists(
  'events',
  'contact_phone',
  `ALTER TABLE events ADD COLUMN contact_phone TEXT DEFAULT '0771004906'`
);
ensureColumnExists(
  'participants',
  'ticket_category',
  `ALTER TABLE participants ADD COLUMN ticket_category TEXT NOT NULL DEFAULT 'STUDENT'`
);

export function withTransaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Ignore rollback failure if transaction was already closed
    }
    throw err;
  }
}

export function bootstrapInitialData(): void {
  const existingEvent = db.prepare('SELECT id, event_name FROM events LIMIT 1').get() as
    | { id: number; event_name: string }
    | undefined;
  if (!existingEvent) {
    db.prepare(`
      INSERT INTO events (
        organizer_name,
        event_name,
        event_date,
        venue,
        dress_code,
        gift_budget,
        ticket_info,
        contact_phone,
        registration_deadline,
        event_status,
        allow_attendance_updates
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', 1)
    `).run(
      'Manifest Association',
      'Makindye Campuses Dinner',
      '2026-12-06T18:00',
      'Garden Light Hotel',
      'Evening Elegant · Black & Gold',
      'UGX 30,000 – UGX 50,000 Wrapped Gift',
      'Student Tickets: UGX 50,000 · Alumni Tickets: UGX 70,000',
      '0771004906',
      '2026-12-03T23:59'
    );
  } else if (existingEvent.event_name === 'Autumn Candlelight Gala 2026') {
    db.prepare(`
      UPDATE events
      SET organizer_name = ?,
          event_name = ?,
          event_date = ?,
          venue = ?,
          dress_code = ?,
          gift_budget = ?,
          ticket_info = ?,
          contact_phone = ?,
          registration_deadline = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      'Manifest Association',
      'Makindye Campuses Dinner',
      '2026-12-06T18:00',
      'Garden Light Hotel',
      'Evening Elegant · Black & Gold',
      'UGX 30,000 – UGX 50,000 Wrapped Gift',
      'Student Tickets: UGX 50,000 · Alumni Tickets: UGX 70,000',
      '0771004906',
      '2026-12-03T23:59',
      existingEvent.id
    );
  }

  const existingAdmin = db.prepare('SELECT id FROM administrators LIMIT 1').get();
  if (!existingAdmin) {
    const bootstrapUsername = process.env.ADMIN_BOOTSTRAP_USERNAME || 'admin';
    const bootstrapEmail = process.env.ADMIN_BOOTSTRAP_EMAIL || 'warlordaa16@gmail.com';
    const bootstrapPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD || 'DinnerPair2026!';
    const passwordHash = bcrypt.hashSync(bootstrapPassword, 10);

    db.prepare(`
      INSERT INTO administrators (username, email, password_hash, role)
      VALUES (?, ?, ?, 'SUPER_ADMIN')
    `).run(bootstrapUsername, bootstrapEmail.toLowerCase(), passwordHash);
  }
}

bootstrapInitialData();
