import { pool } from './db';

export type JobStatus = 'pending' | 'running' | 'done' | 'error';

export interface PageSyncJob {
  id: number;
  status: JobStatus;
  profiles: string[] | null;
  message: string;
  current: number;
  total: number;
  pages_synced: number | null;
  partial: boolean;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

// How long a claimed job stays leased before another tick may steal it.
// Matches the worker channel budget (maxDuration 1200s = 20 min).
const LEASE_MINUTES = 20;

export async function ensureJobTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS page_sync_jobs (
      id            BIGSERIAL PRIMARY KEY,
      status        TEXT        NOT NULL DEFAULT 'pending',
      profiles      TEXT[],
      message       TEXT        NOT NULL DEFAULT '',
      current       INTEGER     NOT NULL DEFAULT 0,
      total         INTEGER     NOT NULL DEFAULT 0,
      pages_synced  INTEGER,
      partial       BOOLEAN     NOT NULL DEFAULT false,
      error         TEXT,
      leased_until  TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      started_at    TIMESTAMPTZ,
      finished_at   TIMESTAMPTZ
    )
  `);
}

/** Insert a pending job. `profiles` null/empty = sync all. Returns its id. */
export async function createPageSyncJob(profiles?: string[]): Promise<number> {
  await ensureJobTable();
  const list = profiles && profiles.length > 0 ? profiles : null;
  const res = await pool.query(
    `INSERT INTO page_sync_jobs (status, profiles, message)
     VALUES ('pending', $1, 'Na fila…') RETURNING id`,
    [list],
  );
  return res.rows[0].id as number;
}

/**
 * Atomically claim the oldest runnable job: a 'pending' one, OR a 'running' one
 * whose lease has expired (crashed mid-run). SKIP LOCKED so concurrent ticks
 * never grab the same row. Returns the claimed job or null if none.
 */
export async function claimNextPageSyncJob(): Promise<PageSyncJob | null> {
  await ensureJobTable();
  const res = await pool.query(
    `UPDATE page_sync_jobs SET
        status = 'running',
        started_at = COALESCE(started_at, now()),
        leased_until = now() + ($1 || ' minutes')::interval,
        message = 'Iniciando…'
      WHERE id = (
        SELECT id FROM page_sync_jobs
         WHERE status = 'pending'
            OR (status = 'running' AND leased_until < now())
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING *`,
    [String(LEASE_MINUTES)],
  );
  return (res.rows[0] as PageSyncJob) ?? null;
}

export async function updateJobProgress(
  id: number,
  p: { message?: string; current?: number; total?: number },
): Promise<void> {
  // Also extends the lease so a long-but-healthy run isn't stolen.
  await pool.query(
    `UPDATE page_sync_jobs SET
        message = COALESCE($2, message),
        current = COALESCE($3, current),
        total = COALESCE($4, total),
        leased_until = now() + ($5 || ' minutes')::interval
      WHERE id = $1`,
    [id, p.message ?? null, p.current ?? null, p.total ?? null, String(LEASE_MINUTES)],
  );
}

export async function completeJob(
  id: number,
  r: { pagesSynced: number; partial: boolean; message: string },
): Promise<void> {
  await pool.query(
    `UPDATE page_sync_jobs SET
        status = 'done', pages_synced = $2, partial = $3, message = $4,
        finished_at = now(), leased_until = NULL
      WHERE id = $1`,
    [id, r.pagesSynced, r.partial, r.message],
  );
}

export async function failJob(id: number, error: string): Promise<void> {
  await pool.query(
    `UPDATE page_sync_jobs SET
        status = 'error', error = $2, message = $2, finished_at = now(), leased_until = NULL
      WHERE id = $1`,
    [id, error.slice(0, 500)],
  );
}

export async function getJob(id: number): Promise<PageSyncJob | null> {
  const res = await pool.query(`SELECT * FROM page_sync_jobs WHERE id = $1`, [id]);
  return (res.rows[0] as PageSyncJob) ?? null;
}
