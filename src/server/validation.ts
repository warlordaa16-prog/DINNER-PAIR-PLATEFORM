export function cleanText(input: unknown, maxLen = 200): string {
  if (typeof input !== 'string') return '';
  return input.trim().replace(/\s+/g, ' ').slice(0, maxLen);
}

export function normalizePhone(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  return hasPlus ? `+${digits}` : digits;
}

export function isValidPhone(normalized: string): boolean {
  const digitsOnly = normalized.replace(/\D/g, '');
  return digitsOnly.length >= 7 && digitsOnly.length <= 15;
}

export function isValidEmail(email: string): boolean {
  if (!email) return true; // optional field
  if (email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export type AttendanceStatus = 'CONFIRMED' | 'PENDING' | 'DECLINED';

export function parseAttendanceStatus(raw: unknown): AttendanceStatus | null {
  if (typeof raw !== 'string') return null;
  const upper = raw.trim().toUpperCase();
  if (upper === 'CONFIRMED' || upper === 'YES, I CONFIRM MY ATTENDANCE.') return 'CONFIRMED';
  if (upper === 'PENDING' || upper === 'NOT YET CONFIRMED.') return 'PENDING';
  if (upper === 'DECLINED' || upper === 'NO, I WILL NOT ATTEND.') return 'DECLINED';
  return null;
}

export function parseConsent(raw: unknown): boolean | null {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw === 1 ? true : raw === 0 ? false : null;
  if (typeof raw === 'string') {
    const val = raw.trim().toLowerCase();
    if (val === 'true' || val === '1' || val === 'yes' || val.includes('agree to participate')) {
      return true;
    }
    if (val === 'false' || val === '0' || val === 'no' || val.includes('do not wish')) {
      return false;
    }
  }
  return null;
}

export type TicketCategory = 'STUDENT' | 'ALUMNI';

export function parseTicketCategory(raw: unknown): TicketCategory | null {
  if (typeof raw !== 'string') return null;
  const val = raw.trim().toUpperCase();
  if (!val) return null;
  if (val === 'STUDENT' || val.includes('STUDENT')) return 'STUDENT';
  if (val === 'ALUMNI' || val.includes('ALUMNI')) return 'ALUMNI';
  return null;
}

export function escapeCsvCell(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  // Protect spreadsheets from formula injection (=, +, -, @)
  const neutralized = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  if (/[",\n\r]/.test(neutralized)) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }
  return neutralized;
}

export function escapeXml(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
