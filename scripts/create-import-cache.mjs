/**
 * Migração: cria a tabela import_cache no Postgres.
 * Executa uma vez: node scripts/create-import-cache.mjs
 *
 * A tabela guarda respostas brutas da Meta e do RedTrack indexadas por
 * (cache_key, date_from, date_to) para que /api/import não precise chamar
 * as APIs externas a cada mudança de filtro.
 */

import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const SQL = `
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
  console.log('✓ Tabela import_cache criada (ou já existia).');
} finally {
  client.release();
  await pool.end();
}
