'use server'

import { pool } from '@/lib/db';
import { invalidateConfigCache } from '@/lib/config';

// Garante que a tabela de configurações existe
async function ensureSettingsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

export async function getStoredTokens() {
  let metaProfiles: { name: string; token: string }[] = [];
  let redtrackKey = '';
  let vturbToken = '';

  // 1. Tenta ler do banco de dados (fonte primária e persistente)
  try {
    await ensureSettingsTable();
    const result = await pool.query(
      `SELECT key, value FROM app_settings WHERE key IN ('META_PROFILES', 'REDTRACK_API_KEY', 'VTURB_API_TOKEN')`
    );
    for (const row of result.rows) {
      if (row.key === 'META_PROFILES') {
        try { metaProfiles = JSON.parse(row.value); } catch {}
      } else if (row.key === 'REDTRACK_API_KEY') {
        redtrackKey = row.value;
      } else if (row.key === 'VTURB_API_TOKEN') {
        vturbToken = row.value;
      }
    }
  } catch (e) {
    // DB indisponível — cai no fallback abaixo
  }

  // 2. Fallback: lê de process.env (compatibilidade com .env.local existente)
  if (metaProfiles.length === 0) {
    try {
      if (process.env.META_PROFILES) {
        metaProfiles = JSON.parse(process.env.META_PROFILES);
      } else if (process.env.META_ACCESS_TOKEN) {
        metaProfiles = [{ name: 'Default', token: process.env.META_ACCESS_TOKEN }];
      }
    } catch {}
  }
  if (!redtrackKey) {
    redtrackKey = process.env.REDTRACK_API_KEY || '';
  }
  if (!vturbToken) {
    vturbToken = process.env.VTURB_API_TOKEN || '';
  }

  return { metaProfiles, redtrackKey, vturbToken };
}

export async function saveApiTokens(
  metaProfiles: { name: string; token: string }[],
  redtrackKey: string,
  vturbToken: string = ''
) {
  try {
    await ensureSettingsTable();

    const profilesStr = JSON.stringify(metaProfiles);

    // Salva no banco de dados (persistente entre reinícios)
    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('META_PROFILES', $1, NOW()),
              ('REDTRACK_API_KEY', $2, NOW()),
              ('VTURB_API_TOKEN', $3, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [profilesStr, redtrackKey, vturbToken]
    );

    // Atualiza process.env para a sessão atual (rotas de sync usam isso)
    process.env.META_PROFILES = profilesStr;
    process.env.REDTRACK_API_KEY = redtrackKey;
    process.env.VTURB_API_TOKEN = vturbToken;
    if (metaProfiles.length > 0) {
      process.env.META_ACCESS_TOKEN = metaProfiles[0].token;
    }

    // Invalida o cache in-memory de lib/config.ts
    invalidateConfigCache();

    return { success: true };
  } catch (err: any) {
    console.error(err);
    return { success: false, error: err.message };
  }
}
