export class ApiError extends Error {
  status: number;
  data?: Record<string, unknown>;

  constructor(message: string, status: number, data?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

const ADMIN_TOKEN_STORAGE_KEY = 'dp_admin_session_token';
let inMemoryAdminToken: string | null = null;

export function setAdminSessionToken(token: string | null): void {
  inMemoryAdminToken = token;
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      if (token) {
        window.sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
      } else {
        window.sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
      }
    }
  } catch {
    // Ignore storage access errors in restricted iframe environments
  }
}

export function getAdminSessionToken(): string | null {
  if (inMemoryAdminToken) return inMemoryAdminToken;
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const stored = window.sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
      if (stored) {
        inMemoryAdminToken = stored;
        return stored;
      }
    }
  } catch {
    // Ignore storage access errors
  }
  return null;
}

export async function apiRequest<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const token = getAdminSessionToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  if (text) {
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = { error: text };
    }
  }

  if (!res.ok) {
    if (
      res.status === 401 &&
      url.startsWith('/api/admin/') &&
      !url.startsWith('/api/admin/login') &&
      !url.startsWith('/api/admin/google-login')
    ) {
      setAdminSessionToken(null);
    }
    const msg =
      typeof parsed.error === 'string'
        ? parsed.error
        : `Request failed with status ${res.status}`;
    throw new ApiError(msg, res.status, parsed);
  }

  return parsed as T;
}

export async function downloadAuthenticatedFile(
  url: string,
  fallbackFilename: string
): Promise<void> {
  const headers = new Headers();
  const token = getAdminSessionToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(url, {
    method: 'GET',
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    const text = await res.text();
    let msg = `Download failed with status ${res.status}`;
    if (text) {
      try {
        const parsed = JSON.parse(text) as { error?: string };
        if (typeof parsed.error === 'string') msg = parsed.error;
      } catch {
        msg = text;
      }
    }
    throw new ApiError(msg, res.status);
  }

  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const filename = match?.[1] || fallbackFilename;

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

