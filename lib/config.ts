/**
 * Utilitário de configuração centralizada.
 * Lê tokens do banco de dados (fonte primária) com fallback para process.env.
 * Isso garante que as rotas de sync funcionem mesmo após reinício do servidor.
 */

import { pool } from './db';

let settingsCache: Record<string, string> | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 minuto

async function loadSettings(): Promise<Record<string, string>> {
  const now = Date.now();
  if (settingsCache && now < cacheExpiry) return settingsCache;

  try {
    const result = await pool.query(
      `SELECT key, value FROM app_settings WHERE key IN ('META_PROFILES', 'REDTRACK_API_KEY')`
    );
    const settings: Record<string, string> = {};
    for (const row of result.rows) {
      settings[row.key] = row.value;
    }
    settingsCache = settings;
    cacheExpiry = now + CACHE_TTL_MS;
    return settings;
  } catch {
    return {};
  }
}

/** Invalida o cache local (chamar após salvar novos tokens) */
export function invalidateConfigCache() {
  settingsCache = null;
  cacheExpiry = 0;
}

/** Retorna a API key do RedTrack */
export async function getRedtrackApiKey(): Promise<string | undefined> {
  const settings = await loadSettings();
  return settings['REDTRACK_API_KEY'] || process.env.REDTRACK_API_KEY;
}

/** Retorna os perfis Meta (lista de {name, token}) */
export async function getMetaProfiles(): Promise<{ name: string; token: string }[]> {
  const settings = await loadSettings();
  try {
    if (settings['META_PROFILES']) {
      return JSON.parse(settings['META_PROFILES']);
    }
  } catch {}
  try {
    if (process.env.META_PROFILES) return JSON.parse(process.env.META_PROFILES);
  } catch {}
  if (process.env.META_ACCESS_TOKEN) {
    return [{ name: 'Default', token: process.env.META_ACCESS_TOKEN }];
  }
  return [];
}
