// Task A3 — Google Drive download lib — Contract 2 of docs/superpowers/plans/
// 2026-06-11-campaign-builder-features.md. Real implementation by Task A3:
// user-OAuth refresh token stored in app_settings under GOOGLE_DRIVE_OAUTH,
// plain-fetch Drive REST (no googleapis npm package).

import { pool } from './db';

export class DriveAuthError extends Error {
  constructor(message = 'Google Drive não conectado') {
    super(message);
    this.name = 'DriveAuthError';
  }
}

// ── app_settings helpers ──────────────────────────────────────────────────────

const SETTINGS_KEY = 'GOOGLE_DRIVE_OAUTH';

interface DriveOAuthRecord {
  refresh_token: string;
  email: string;
  connected_at: string;
}

async function ensureSettingsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

export async function getGoogleDriveOAuth(): Promise<DriveOAuthRecord | null> {
  // NOTE: do NOT wrap in a blanket try/catch here.
  // A genuine "not connected" case is a 0-row result → return null.
  // DB connection failures (pool timeout/exhaustion) or corrupt-JSON must propagate
  // so that isTransientMediaError() in campaign-jobs-core can classify them as
  // transient (network/TypeError) instead of silently returning null → DriveAuthError
  // (permanent), which would permanently kill a campaign job on a momentary DB blip.
  await ensureSettingsTable();
  const res = await pool.query(
    `SELECT value FROM app_settings WHERE key = $1`,
    [SETTINGS_KEY]
  );
  if (res.rows.length === 0) return null;
  // JSON.parse errors (corrupt stored value) propagate intentionally — they should
  // surface as a visible Error rather than silently masking data corruption.
  return JSON.parse(res.rows[0].value) as DriveOAuthRecord;
}

export async function setGoogleDriveOAuth(record: DriveOAuthRecord): Promise<void> {
  await ensureSettingsTable();
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [SETTINGS_KEY, JSON.stringify(record)]
  );
}

export async function deleteGoogleDriveOAuth(): Promise<void> {
  await ensureSettingsTable();
  await pool.query(`DELETE FROM app_settings WHERE key = $1`, [SETTINGS_KEY]);
}

// ── Access-token cache (module-level, server memory) ─────────────────────────

let _cachedAccessToken: string | null = null;
let _cacheExpiresAt = 0; // epoch ms

export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (_cachedAccessToken && now < _cacheExpiresAt) {
    return _cachedAccessToken;
  }

  const record = await getGoogleDriveOAuth();
  if (!record?.refresh_token) {
    throw new DriveAuthError('Google Drive não conectado');
  }

  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
    refresh_token: record.refresh_token,
    grant_type: 'refresh_token',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new DriveAuthError(`Falha ao renovar token do Google Drive: ${text}`);
  }

  const json = await res.json();
  const accessToken: string = json.access_token;
  // expires_in is seconds; subtract 60s buffer
  const expiresIn: number = (json.expires_in ?? 3600) - 60;

  _cachedAccessToken = accessToken;
  _cacheExpiresAt = now + expiresIn * 1000;

  return accessToken;
}

/** Invalidate the in-memory token cache (call after disconnecting). */
export function invalidateAccessTokenCache() {
  _cachedAccessToken = null;
  _cacheExpiresAt = 0;
}

// ── Typed HTTP error (transient classifier reads .httpStatus) ────────────────

/**
 * Thrown by getDriveFileMeta / downloadDriveFile when Drive returns a non-auth,
 * non-permission HTTP error (e.g. 429 rate-limit, 500-5xx outage).
 * Carries `httpStatus` so that campaign-jobs-core.isTransientMediaError can
 * recognise 429 and 5xx as resumable transient errors rather than permanent
 * failures.  401 / 403 continue to throw DriveAuthError (permanent).
 */
export class DriveHttpError extends Error {
  httpStatus: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'DriveHttpError';
    this.httpStatus = status;
  }
}

// ── Public API — signatures are contract, keep stable ────────────────────────

export async function getDriveFileMeta(
  fileId: string
): Promise<{ name: string; mimeType: string; size: number }> {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set('fields', 'name,mimeType,size');
  url.searchParams.set('supportsAllDrives', 'true');

  // Allow one automatic retry on HTTP 401: the cached access token may have
  // been rotated by Google before our 59-min TTL (or clock skew defeated the
  // 60s buffer). On the first 401 we bust the cache and immediately fetch a
  // fresh token; if that new token still gets a 401, the refresh_token itself
  // has been revoked and we surface a permanent DriveAuthError.
  // A 403 (permission denied) is never a token-expiry and is NOT retried.
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getAccessToken();

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      if (res.status === 401) {
        // Bust the cache so the next getAccessToken() call exchanges the
        // refresh_token for a brand-new access token.
        invalidateAccessTokenCache();
        if (attempt === 0) continue; // retry once with a fresh token
        // Second 401 → refresh_token itself is revoked (permanent failure).
        throw new DriveAuthError(`Sem acesso ao arquivo do Google Drive: ${text}`);
      }
      if (res.status === 403) {
        // Google Drive v3 returns HTTP 403 — not 429 — for quota/rate-limit
        // throttling (reason codes: 'userRateLimitExceeded', 'rateLimitExceeded').
        // We must distinguish these transient 403s from a true permission-denied
        // 403, otherwise isTransientMediaError() in campaign-jobs-core classifies
        // quota throttling as a PERMANENT failure and terminates the campaign job.
        const isRateLimit = /userRateLimitExceeded|rateLimitExceeded/.test(text);
        if (isRateLimit) {
          // Treat as transient: the worker will pause-and-resume on the next tick.
          throw new DriveHttpError(429, `Drive quota exceeded (retry later): ${text}`);
        }
        // True permission-denied — not a token expiry and not a transient error;
        // surface as permanent DriveAuthError so the job fails clearly.
        throw new DriveAuthError(`Sem acesso ao arquivo do Google Drive: ${text}`);
      }
      throw new DriveHttpError(res.status, `Drive API error ${res.status}: ${text}`);
    }

    const json = await res.json();
    return {
      name: json.name ?? '',
      mimeType: json.mimeType ?? '',
      size: Number(json.size ?? 0),
    };
  }

  // Unreachable — TypeScript needs an explicit return after the loop.
  throw new DriveAuthError('Sem acesso ao arquivo do Google Drive');
}

export async function downloadDriveFile(fileId: string): Promise<Buffer> {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set('alt', 'media');
  url.searchParams.set('supportsAllDrives', 'true');

  // Allow one automatic retry on HTTP 401: the cached access token may have
  // been rotated by Google before our 59-min TTL (or clock skew defeated the
  // 60s buffer). On the first 401 we bust the cache and immediately fetch a
  // fresh token; if that new token still gets a 401, the refresh_token itself
  // has been revoked and we surface a permanent DriveAuthError.
  // A 403 (permission denied) is never a token-expiry and is NOT retried.
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getAccessToken();

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      if (res.status === 401) {
        // Bust the cache so the next getAccessToken() call exchanges the
        // refresh_token for a brand-new access token.
        invalidateAccessTokenCache();
        if (attempt === 0) continue; // retry once with a fresh token
        // Second 401 → refresh_token itself is revoked (permanent failure).
        throw new DriveAuthError(`Sem acesso ao arquivo do Google Drive: ${text}`);
      }
      if (res.status === 403) {
        // Google Drive v3 returns HTTP 403 — not 429 — for quota/rate-limit
        // throttling (reason codes: 'userRateLimitExceeded', 'rateLimitExceeded').
        // We must distinguish these transient 403s from a true permission-denied
        // 403, otherwise isTransientMediaError() in campaign-jobs-core classifies
        // quota throttling as a PERMANENT failure and terminates the campaign job.
        const isRateLimit = /userRateLimitExceeded|rateLimitExceeded/.test(text);
        if (isRateLimit) {
          // Treat as transient: the worker will pause-and-resume on the next tick.
          throw new DriveHttpError(429, `Drive quota exceeded (retry later): ${text}`);
        }
        // True permission-denied — not a token expiry and not a transient error;
        // surface as permanent DriveAuthError so the job fails clearly.
        throw new DriveAuthError(`Sem acesso ao arquivo do Google Drive: ${text}`);
      }
      throw new DriveHttpError(res.status, `Drive download error ${res.status}: ${text}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  // Unreachable — TypeScript needs an explicit return after the loop.
  throw new DriveAuthError('Sem acesso ao arquivo do Google Drive');
}
