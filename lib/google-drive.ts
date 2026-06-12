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
  try {
    await ensureSettingsTable();
    const res = await pool.query(
      `SELECT value FROM app_settings WHERE key = $1`,
      [SETTINGS_KEY]
    );
    if (res.rows.length === 0) return null;
    return JSON.parse(res.rows[0].value) as DriveOAuthRecord;
  } catch {
    return null;
  }
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

// ── Public API — signatures are contract, keep stable ────────────────────────

export async function getDriveFileMeta(
  fileId: string
): Promise<{ name: string; mimeType: string; size: number }> {
  const token = await getAccessToken();

  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set('fields', 'name,mimeType,size');
  url.searchParams.set('supportsAllDrives', 'true');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    if (res.status === 401) {
      // Bust the cache — the access token is dead; next caller will refresh.
      invalidateAccessTokenCache();
      throw new DriveAuthError(`Sem acesso ao arquivo do Google Drive: ${text}`);
    }
    if (res.status === 403) {
      // Permission denied — not a token expiry; do NOT bust the cache.
      throw new DriveAuthError(`Sem acesso ao arquivo do Google Drive: ${text}`);
    }
    throw new Error(`Drive API error ${res.status}: ${text}`);
  }

  const json = await res.json();
  return {
    name: json.name ?? '',
    mimeType: json.mimeType ?? '',
    size: Number(json.size ?? 0),
  };
}

export async function downloadDriveFile(fileId: string): Promise<Buffer> {
  const token = await getAccessToken();

  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set('alt', 'media');
  url.searchParams.set('supportsAllDrives', 'true');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    if (res.status === 401) {
      // Bust the cache — the access token is dead; next caller will refresh.
      invalidateAccessTokenCache();
      throw new DriveAuthError(`Sem acesso ao arquivo do Google Drive: ${text}`);
    }
    if (res.status === 403) {
      // Permission denied — not a token expiry; do NOT bust the cache.
      throw new DriveAuthError(`Sem acesso ao arquivo do Google Drive: ${text}`);
    }
    throw new Error(`Drive download error ${res.status}: ${text}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
