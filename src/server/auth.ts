import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { db } from './db.ts';

if (!getApps().length) {
  initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

const adminAuth = getAuth();

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto.createHash('sha256').update(`${process.cwd()}-dinner-pair-dev-secret`).digest('hex');

export const ADMIN_COOKIE_NAME = 'dp_admin_session';

export interface AdminUserRecord {
  id: number;
  username: string;
  email: string;
  role: 'SUPER_ADMIN' | 'ADMIN';
}

export interface AdminRequest extends Request {
  admin?: AdminUserRecord;
}

export function hashSha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function generateNumericCode(length = 6): string {
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length);
  return String(crypto.randomInt(min, max));
}

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(val);
      } catch {
        result[key] = val;
      }
    }
  }
  return result;
}

function isHttpsRequest(req: Request): boolean {
  const proto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  return req.secure || proto.includes('https') || (process.env.APP_URL || '').startsWith('https://');
}

export function extractAdminToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return bearer;
  }
  const cookies = parseCookies(req);
  return cookies[ADMIN_COOKIE_NAME] || null;
}

export function createAdminSession(adminId: number, req: Request, res: Response): string {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashSha256(`${rawToken}:${SESSION_SECRET}`);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString(); // 12h

  db.prepare(`
    INSERT INTO admin_sessions (admin_id, token_hash, expires_at)
    VALUES (?, ?, ?)
  `).run(adminId, tokenHash, expiresAt);

  // Clean up expired sessions opportunistically
  db.prepare(`DELETE FROM admin_sessions WHERE expires_at < datetime('now')`).run();

  const isHttps = isHttpsRequest(req);
  res.cookie(ADMIN_COOKIE_NAME, rawToken, {
    httpOnly: true,
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
    maxAge: 1000 * 60 * 60 * 12,
    path: '/',
  });

  return rawToken;
}

export function revokeAdminSession(req: Request, res: Response): void {
  const rawToken = extractAdminToken(req);
  if (rawToken) {
    const tokenHash = hashSha256(`${rawToken}:${SESSION_SECRET}`);
    db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(tokenHash);
  }
  const isHttps = isHttpsRequest(req);
  res.clearCookie(ADMIN_COOKIE_NAME, {
    path: '/',
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
  });
}

export function getAuthenticatedAdmin(req: Request): AdminUserRecord | null {
  const rawToken = extractAdminToken(req);
  if (!rawToken) return null;

  const tokenHash = hashSha256(`${rawToken}:${SESSION_SECRET}`);
  const row = db
    .prepare(`
      SELECT a.id, a.username, a.email, a.role, s.expires_at
      FROM admin_sessions s
      JOIN administrators a ON a.id = s.admin_id
      WHERE s.token_hash = ?
    `)
    .get(tokenHash) as
    | {
        id: number;
        username: string;
        email: string;
        role: 'SUPER_ADMIN' | 'ADMIN';
        expires_at: string;
      }
    | undefined;

  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }

  return {
    id: row.id,
    username: row.username,
    email: row.email,
    role: row.role,
  };
}

export function requireAdmin(req: AdminRequest, res: Response, next: NextFunction): void {
  const admin = getAuthenticatedAdmin(req);
  if (!admin) {
    res.status(401).json({ error: 'Administrator authentication required.' });
    return;
  }
  req.admin = admin;
  next();
}

export async function verifyFirebaseIdToken(idToken: string) {
  return await adminAuth.verifyIdToken(idToken);
}

export function logAudit(
  admin: AdminUserRecord,
  action: string,
  affectedRecord: string,
  details?: string
): void {
  db.prepare(`
    INSERT INTO audit_logs (administrator_id, administrator_label, action, affected_record, details)
    VALUES (?, ?, ?, ?, ?)
  `).run(admin.id, admin.username, action, affectedRecord, details || null);
}
