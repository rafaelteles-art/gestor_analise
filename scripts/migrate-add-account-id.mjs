/**
 * Migração: adiciona account_id em meta_ads_metrics e cria import_cache.
 * Executa uma vez: node scripts/migrate-add-account-id.mjs
 */

import pg from 'pg';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Carrega .env.local (Next.js) ou .env raiz, sem depender do pacote dotenv
const envCandidates = [
  resolve(__dirname, '../.env.local'),
  resolve(__dirname, '../.env'),
  resolve(__dirname, '../../.env'),
];
const envPath = envCandidates.find(p => { try { readFileSync(p); return true; } catch { return false; } }) ?? '';
try {
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  console.warn('Arquivo .env não encontrado — usando variáveis de ambiente do sistema.');
}

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const SQL = `
-- 1. Adiciona account_id em meta_ads_metrics (se ainda não existir)
ALTER TABLE public.meta_ads_metrics
  ADD COLUMN IF NOT EXISTS account_id VARCHAR;

-- 2. Cria índice para queries por account_id + date
CREATE INDEX IF NOT EXISTS idx_meta_ads_metrics_account_date
  ON public.meta_ads_metrics (account_id, date);

-- 3. Tabela de cache para /api/import (resposta bruta da Meta + RT por período)
CREATE TABLE IF NOT EXISTS import_cache (
  cache_key   TEXT        NOT NULL,
  date_from   DATE        NOT NULL,
  date_to     DATE        NOT NULL,
  data        JSONB       NOT NULL,
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (cache_key, date_from, date_to)
);

CREATE INDEX IF NOT EXISTS idx_import_cache_synced
  ON import_cache (cache_key, date_from, date_to, synced_at);
`;

const client = await pool.connect();
try {
  await client.query(SQL);
  console.log('✓ Migração concluída:');
  console.log('  - account_id adicionado em meta_ads_metrics');
  console.log('  - Tabela import_cache criada');
} catch (err) {
  console.error('✗ Erro na migração:', err.message);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
