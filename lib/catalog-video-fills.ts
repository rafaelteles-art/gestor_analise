// Scheduled Video Fill records (docs/adr/0008): one deferred, catalog-level fill per
// (catalog_id, fire_date), armed at campaign creation, run once at 08:30 GMT-3.
import { pool } from './db';
import { nextDailyRunAfter } from './timezone';
import { getCatalogVideoSheet } from './meta-catalogs';

const FILL_HOUR = 8;
const FILL_MINUTE = 30;
const RUNNING_LEASE_MIN = 20; // a 'running' row older than this is reclaimable (crash recovery)

export interface CatalogVideoFill {
  id: number;
  catalog_id: string;
  catalog_name: string | null;
  fire_date: string; // 'YYYY-MM-DD' (GMT-3)
  fire_at: string;   // ISO
  status: 'pending' | 'running' | 'done' | 'failed' | 'canceled';
  armed_by: string | null;
  armed_at: string;
  ran_at: string | null;
  outcome: any | null;
}

async function ensureVideoFillsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS catalog_video_fills (
      id           BIGSERIAL PRIMARY KEY,
      catalog_id   TEXT NOT NULL,
      catalog_name TEXT,
      fire_date    DATE NOT NULL,
      fire_at      TIMESTAMPTZ NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      armed_by     TEXT,
      armed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      ran_at       TIMESTAMPTZ,
      outcome      JSONB,
      UNIQUE (catalog_id, fire_date)
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS catalog_video_fills_due_idx ON catalog_video_fills (status, fire_at)`,
  );
}

/** Arm a fill for the next 08:30 GMT-3 after now. One per (catalog, fire_date):
 *  a second campaign on the same catalog the same day is a no-op (returns armed=false
 *  with the existing row). Requires the catalog to have a linked Video Sheet. */
export async function armCatalogVideoFill(
  catalogId: string,
  armedBy: string | null = null,
): Promise<{ armed: boolean; fill: CatalogVideoFill }> {
  await ensureVideoFillsTable();
  const sheet = await getCatalogVideoSheet(catalogId);
  if (!sheet) throw new Error('Catálogo sem planilha vinculada — vincule uma planilha antes de agendar.');

  const { fireAt, fireDate } = nextDailyRunAfter(new Date(), FILL_HOUR, FILL_MINUTE);
  const ins = await pool.query(
    `INSERT INTO catalog_video_fills (catalog_id, catalog_name, fire_date, fire_at, armed_by)
     VALUES ($1, $2, $3::date, $4, $5)
     ON CONFLICT (catalog_id, fire_date) DO NOTHING
     RETURNING *`,
    [catalogId.trim(), sheet.catalog_name, fireDate, fireAt.toISOString(), armedBy],
  );
  if (ins.rows[0]) return { armed: true, fill: ins.rows[0] as CatalogVideoFill };

  const existing = await pool.query(
    `SELECT * FROM catalog_video_fills WHERE catalog_id = $1 AND fire_date = $2::date`,
    [catalogId.trim(), fireDate],
  );
  return { armed: false, fill: existing.rows[0] as CatalogVideoFill };
}

/** Atomically claim one due fill (fire_at reached), recovering stale 'running' rows. */
export async function claimDueVideoFill(): Promise<CatalogVideoFill | null> {
  await ensureVideoFillsTable();
  const { rows } = await pool.query(
    `UPDATE catalog_video_fills
        SET status = 'running', ran_at = now()
      WHERE id = (
        SELECT id FROM catalog_video_fills
         WHERE fire_at <= now()
           AND ( status = 'pending'
                 OR (status = 'running' AND ran_at < now() - ($1 || ' minutes')::interval) )
         ORDER BY fire_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )
      RETURNING *`,
    [String(RUNNING_LEASE_MIN)],
  );
  return (rows[0] as CatalogVideoFill) ?? null;
}

/** Record the terminal outcome of a claimed fill (done or failed). One-pass, no retry. */
export async function finishVideoFill(
  id: number,
  status: 'done' | 'failed',
  outcome: unknown,
): Promise<void> {
  await pool.query(
    `UPDATE catalog_video_fills SET status = $2, outcome = $3::jsonb, ran_at = now() WHERE id = $1`,
    [id, status, JSON.stringify(outcome ?? null)],
  );
}

/** Fills for a catalog, newest first (for the /catalogo "Preenchimentos" view). */
export async function listVideoFills(catalogId: string, limit = 30): Promise<CatalogVideoFill[]> {
  await ensureVideoFillsTable();
  const capped = Math.max(1, Math.min(100, Math.floor(limit)));
  const { rows } = await pool.query(
    `SELECT * FROM catalog_video_fills WHERE catalog_id = $1 ORDER BY fire_at DESC, id DESC LIMIT $2`,
    [catalogId.trim(), capped],
  );
  return rows as CatalogVideoFill[];
}

/** Cancel a still-pending fill. No-op (canceled=false) if it already ran/canceled. */
export async function cancelVideoFill(id: number): Promise<{ canceled: boolean }> {
  await ensureVideoFillsTable();
  const { rowCount } = await pool.query(
    `UPDATE catalog_video_fills SET status = 'canceled' WHERE id = $1 AND status = 'pending'`,
    [id],
  );
  return { canceled: (rowCount ?? 0) > 0 };
}
