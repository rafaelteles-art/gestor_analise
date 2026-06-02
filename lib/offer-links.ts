import { pool } from './db';

/**
 * Camada de dados dos vínculos de Oferta (ADR-0003).
 * Tudo referencia ofertas.id — nunca nome.
 */

/** Helper puro: nomes que aparecem em arrays de conta mas não existem em ofertas. */
export function orphanOfferNames(accountNames: string[], existingOffers: string[]): string[] {
  const have = new Set(existingOffers);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of accountNames) {
    if (!n) continue;
    if (have.has(n)) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/** Cria/altera todo o schema dos vínculos. Idempotente — seguro a cada load. */
export async function ensureOfferLinkSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ofertas (
      id SERIAL PRIMARY KEY,
      nome VARCHAR(255) NOT NULL UNIQUE,
      status VARCHAR(20) NOT NULL DEFAULT 'ATIVO',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS redtrack_campaign_selections (
      id          uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
      campaign_id character varying NOT NULL UNIQUE,
      campaign_name character varying,
      status      character varying,
      is_selected boolean DEFAULT false,
      created_at  timestamp with time zone DEFAULT now()
    )
  `);

  await pool.query(`
    ALTER TABLE redtrack_campaign_selections
      ADD COLUMN IF NOT EXISTS oferta_id INTEGER REFERENCES ofertas(id) ON DELETE SET NULL
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS vturb_players (
      player_id      TEXT PRIMARY KEY,
      player_name    TEXT,
      video_duration INTEGER,
      pitch_time     INTEGER,
      oferta_id      INTEGER REFERENCES ofertas(id) ON DELETE SET NULL,
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_vturb_players_oferta ON vturb_players (oferta_id)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS meta_account_offers (
      account_id TEXT NOT NULL,
      oferta_id  INTEGER NOT NULL REFERENCES ofertas(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (account_id, oferta_id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mao_oferta ON meta_account_offers (oferta_id)`);
}

/**
 * Backfill idempotente do join table a partir do array de nomes legado
 * (meta_ad_accounts.oferta). Loga nomes órfãos. NÃO dropa a coluna oferta.
 */
export async function backfillMetaAccountOffers(): Promise<string[]> {
  const hasCol = await pool.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'meta_ad_accounts' AND column_name = 'oferta'
  `);
  if (hasCol.rowCount === 0) return [];

  await pool.query(`
    INSERT INTO meta_account_offers (account_id, oferta_id)
    SELECT m.account_id, o.id
    FROM meta_ad_accounts m
    CROSS JOIN LATERAL unnest(COALESCE(m.oferta, '{}'::text[])) AS oferta_name
    JOIN ofertas o ON o.nome = oferta_name
    ON CONFLICT (account_id, oferta_id) DO NOTHING
  `);

  const orphanRes = await pool.query<{ oferta_name: string }>(`
    SELECT DISTINCT oferta_name
    FROM meta_ad_accounts m
    CROSS JOIN LATERAL unnest(COALESCE(m.oferta, '{}'::text[])) AS oferta_name
    WHERE NOT EXISTS (SELECT 1 FROM ofertas o WHERE o.nome = oferta_name)
  `);
  const orphans = orphanRes.rows.map(r => r.oferta_name);
  if (orphans.length) {
    console.warn('[offer-links] nomes de oferta órfãos (sem match em ofertas):', orphans);
  }
  return orphans;
}

/** player_ids vinculados a alguma oferta — usado para escopar o sync de métricas. */
export async function fetchLinkedPlayerIds(): Promise<Set<string>> {
  const res = await pool.query<{ player_id: string }>(
    `SELECT player_id FROM vturb_players WHERE oferta_id IS NOT NULL`,
  );
  return new Set(res.rows.map(r => r.player_id));
}
