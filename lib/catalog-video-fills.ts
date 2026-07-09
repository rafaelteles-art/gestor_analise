// Scheduled Video Fill records (docs/adr/0008 + 0010): one deferred, catalog-level
// fill per (catalog_id, fire_date), armed at campaign creation, fired at the next
// 08:30 GMT-3 anchor or at an operator-chosen `creation + N h`. At most ONE pending
// fill per catalog/day (re-anchored to the earlier time); completed fills never
// block a new arm. Pure timing/arm logic lives in catalog-video-fills-core.ts.
import { pool } from './db';
import {
  computeFillTiming,
  runArmVideoFill,
  LEGACY_UNIQ_DROP_SQL,
  PENDING_UNIQ_INDEX_SQL,
} from './catalog-video-fills-core';
import { getCatalogVideoSheet } from './meta-catalogs';

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
      outcome      JSONB
    )
  `);
  // Migração 0010: a unicidade por (catálogo, dia) vale só para PENDENTES —
  // um fill done não pode bloquear um novo arm no mesmo dia.
  await pool.query(LEGACY_UNIQ_DROP_SQL);
  await pool.query(PENDING_UNIQ_INDEX_SQL);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS catalog_video_fills_due_idx ON catalog_video_fills (status, fire_at)`,
  );
}

/** Arm a fill (docs/adr/0010): `hoursFromNow=null` → next 08:30 GMT-3 anchor;
 *  integer 0–24 → creation + N h (0 = next poller tick). At most one PENDING
 *  per (catalog, fire_date): an arm against an existing later pending re-anchors
 *  it to the earlier time (`reanchored`); an earlier pending wins (armed=false).
 *  Completed/failed/canceled fills never block. Requires a linked Video Sheet. */
export async function armCatalogVideoFill(
  catalogId: string,
  armedBy: string | null = null,
  hoursFromNow: number | null = null,
): Promise<{ armed: boolean; reanchored: boolean; fill: CatalogVideoFill }> {
  await ensureVideoFillsTable();
  const id = catalogId.trim();
  const sheet = await getCatalogVideoSheet(id);
  if (!sheet) throw new Error('Catálogo sem planilha vinculada — vincule uma planilha antes de agendar.');

  const { fireAt, fireDate } = computeFillTiming(new Date(), hoursFromNow);
  return runArmVideoFill<CatalogVideoFill>(
    { query: (sql, values) => pool.query(sql, values as any[]) },
    { catalogId: id, catalogName: sheet.catalog_name, armedBy, fireAt, fireDate },
  );
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
  await ensureVideoFillsTable();
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
