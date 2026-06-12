// Persistent per-Profile campaign job queue. Mirrors the proven page_sync_jobs
// pattern in lib/sync-jobs.ts (FOR UPDATE SKIP LOCKED claim, leased_until lease,
// JSONB checkpoints) but adds per-Profile FIFO serialization: at most one job
// per profile_name runs at a time, so the same Meta token never fires two
// concurrent campaign batches. Spec: docs/superpowers/plans/
// 2026-06-11-campaign-builder-features.md (Task A1) + docs/adr/0005.

import { pool } from './db';
import type {
  BatchRunState,
  BatchEvent,
  CreativeMedia,
} from './batch-contract';
import { createCampaignBatch } from './meta-campaigns';
import {
  uploadImage,
  uploadVideo,
} from './meta-campaigns';
import { downloadDriveFile, getDriveFileMeta } from './google-drive';
import {
  pickRunnableJobId,
  reduceCounts,
  clampListLimit,
  isTransientMediaError,
  normalizeBatchInput,
  type CampaignJobStatus,
  type JobCounts,
  type RunnableJobView,
} from './campaign-jobs-core';

// Re-export the pure helpers + their types so callers (and tests) can import
// them from either module; the canonical implementations live in
// ./campaign-jobs-core (kept dependency-free for unit testing).
export {
  pickRunnableJobId,
  reduceCounts,
  clampListLimit,
  isTransientMediaError,
  normalizeBatchInput,
  type CampaignJobStatus,
  type JobCounts,
  type RunnableJobView,
};

// Wave-1 integration: meta-campaigns.ts now exports createCampaignBatch with the
// shared-contract signature exactly — createCampaignBatch(input: BatchCreateInput,
// opts: BatchRunOpts): Promise<BatchRunResult>, which is structurally the
// CreateCampaignBatchFn from batch-contract.ts (BatchCreateInput is assignable to
// the contract's `input: any`). The previous `as unknown as CreateCampaignBatchFn`
// double-cast existed only because the signature had not landed yet; it is removed
// so the worker now calls the real, type-checked orchestrator directly. The
// normalized payload from buildBatchInput() is `any`, which assigns to
// BatchCreateInput, so the call below stays type-safe.
const runBatch = createCampaignBatch;

export interface CampaignJob {
  id: number;
  status: CampaignJobStatus;
  profile_name: string;
  account_id: string;
  account_name: string | null;
  broadcast_group_id: string | null;
  payload: any;
  run_state: BatchRunState;
  events: BatchEvent[];
  counts: JobCounts;
  error: string | null;
  cancel_requested: boolean;
  leased_until: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

/** Row for the list endpoint — same as CampaignJob minus the heavy payload. */
export type CampaignJobListRow = Omit<CampaignJob, 'payload'>;

// How long a claimed job stays leased before another tick may steal it. Matches
// the worker channel budget (cron maxDuration 1200s) with headroom over the
// 270s tick budget so a healthy in-progress job is never stolen mid-tick.
const LEASE_MINUTES = 20;

// Re-read cancel_requested from the DB at most this often (every N events) so a
// long job reacts to a cancel without hammering the DB on every entity.
const CANCEL_RECHECK_EVERY = 5;

const DEFAULT_BUDGET_MS = 270_000;

const ALL_COLUMNS_NO_PAYLOAD =
  'id, status, profile_name, account_id, account_name, broadcast_group_id, ' +
  'run_state, events, counts, error, cancel_requested, leased_until, ' +
  'created_at, started_at, finished_at';

export async function ensureCampaignJobsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaign_jobs (
      id BIGSERIAL PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      profile_name TEXT NOT NULL,
      account_id TEXT NOT NULL,
      account_name TEXT,
      broadcast_group_id TEXT,
      payload JSONB NOT NULL,
      run_state JSONB NOT NULL DEFAULT '{"created":{},"failed":{}}'::jsonb,
      events JSONB NOT NULL DEFAULT '[]'::jsonb,
      counts JSONB NOT NULL DEFAULT '{"created":0,"failed":0,"skipped":0,"total":0}'::jsonb,
      error TEXT,
      cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
      leased_until TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS campaign_jobs_claim_idx ON campaign_jobs (profile_name, status, id)`
  );
}

export interface EnqueueJobInput {
  profile_name: string;
  account_id: string;
  account_name?: string | null;
  payload: any;
}

/**
 * Insert one or more pending jobs (one per ad account for a broadcast). All jobs
 * in the same call share a broadcast_group_id. Returns the new ids in input order.
 *
 * ALL-OR-NOTHING (review fix): a multi-account broadcast is inserted inside a
 * single BEGIN/COMMIT on one pooled client. Previously the N rows were inserted as
 * N independent pool.query() calls in a for-loop; if any INSERT threw mid-loop (DB
 * blip, connection drop) the earlier accounts' jobs were ALREADY committed and
 * would run, while the route returned 500. The user, seeing a failure, naturally
 * retries the whole broadcast — and since there is no idempotency key on enqueue,
 * the accounts that already enqueued got a DUPLICATE set of real campaigns
 * (double-spend). Wrapping the per-account INSERTs in one transaction makes the
 * broadcast atomic: either every account's job is committed or none is, so a
 * retry-after-failure can never duplicate a partial broadcast.
 */
export async function enqueueCampaignJobs(
  jobs: EnqueueJobInput[],
  opts?: { broadcast_group_id?: string }
): Promise<{ ids: number[]; broadcast_group_id: string }> {
  await ensureCampaignJobsTable();
  const broadcast_group_id =
    opts?.broadcast_group_id ?? globalThis.crypto.randomUUID();

  const ids: number[] = [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const j of jobs) {
      // total is computed by the orchestrator once it expands the batch; we seed
      // counts with zeros and let onEvent fill them in. We DO stamp broadcast_group_id
      // even for single-account jobs so history can always group consistently.
      const res = await client.query(
        `INSERT INTO campaign_jobs
           (status, profile_name, account_id, account_name, broadcast_group_id, payload)
         VALUES ('pending', $1, $2, $3, $4, $5::jsonb)
         RETURNING id`,
        [
          j.profile_name,
          j.account_id,
          j.account_name ?? null,
          broadcast_group_id,
          JSON.stringify(j.payload),
        ]
      );
      ids.push(Number(res.rows[0].id));
    }
    await client.query('COMMIT');
  } catch (err) {
    // Roll back so NO partial subset of the broadcast survives. The caller gets the
    // throw and returns an error; because nothing committed, a user retry re-enqueues
    // the FULL broadcast exactly once (no double-spend on the already-inserted rows).
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { ids, broadcast_group_id };
}

/**
 * Atomically claim the next runnable job with RACE-SAFE per-Profile FIFO
 * serialization.
 *
 * Runnable =
 *   (status 'pending' AND no OTHER job with the same profile_name is currently
 *    'running' with an unexpired lease)
 *   OR
 *   (status 'running' with an expired/null lease — crashed mid-run, resume).
 *
 * Why a plain NOT EXISTS guard is NOT enough — and why we add a profile-keyed
 * advisory lock:
 *   Under READ COMMITTED, the correlated `NOT EXISTS (… status='running' …)`
 *   subquery is evaluated against each transaction's own snapshot. Two ticks can
 *   each claim a DIFFERENT pending job for the SAME profile: tick A locks+flips
 *   J1 (profile P) to 'running' but has not committed; tick B's snapshot predates
 *   A's change, so B still sees "no live P run", skips A's row via SKIP LOCKED,
 *   and claims J2 (also profile P). Both commit → two concurrent batches on one
 *   Meta token, defeating ADR-0005. `FOR UPDATE SKIP LOCKED` only locks the chosen
 *   candidate row, never the sibling pending rows, and does not re-evaluate the
 *   correlated NOT EXISTS across the other in-flight transaction.
 *
 *   The fix is a real mutual-exclusion primitive keyed by profile_name:
 *   `pg_try_advisory_xact_lock(hashtext(profile_name))`. The lock is held by THIS
 *   claim's implicit transaction until it commits — i.e. exactly until the
 *   `status='running'` flip becomes visible to everyone else. So when tick B tries
 *   to claim for profile P it must first win the same profile lock; it can only do
 *   so AFTER tick A has committed, at which point A's running row IS visible and
 *   B's NOT EXISTS correctly blocks. The lock is non-blocking (`try_`): if another
 *   tx currently holds profile P's lock, that profile's candidates are simply
 *   skipped and the SELECT considers the next profile's jobs — no head-of-line
 *   blocking across profiles, no deadlock. The lock is the LAST conjunct so it is
 *   only acquired for rows that already passed the cheaper status / NOT EXISTS /
 *   lease predicates (Postgres short-circuits AND left→right), minimising
 *   transiently-held locks. hashtext() can collide across distinct profile names,
 *   which would only make the claim slightly more conservative (serialize two
 *   unrelated profiles for one fast UPDATE) — never less safe.
 *
 * Ordered by id (FIFO). SKIP LOCKED so concurrent ticks never grab the same row.
 * Single UPDATE … RETURNING flips it to 'running', stamps started_at (first time
 * only) and a fresh 20-minute lease. Returns the claimed job or null.
 */
export async function claimNextCampaignJob(): Promise<CampaignJob | null> {
  await ensureCampaignJobsTable();
  const res = await pool.query(
    `UPDATE campaign_jobs SET
        status = 'running',
        started_at = COALESCE(started_at, now()),
        leased_until = now() + ($1 || ' minutes')::interval
      WHERE id = (
        SELECT j.id FROM campaign_jobs j
         WHERE
           (
             (
               j.status = 'pending'
               AND NOT EXISTS (
                 SELECT 1 FROM campaign_jobs r
                  WHERE r.profile_name = j.profile_name
                    AND r.status = 'running'
                    AND r.leased_until IS NOT NULL
                    AND r.leased_until > now()
               )
             )
             OR (
               j.status = 'running'
               AND (j.leased_until IS NULL OR j.leased_until < now())
             )
           )
           -- LAST conjunct on purpose: only acquired for rows that already passed
           -- the predicates above. Held by this claim's tx until commit, making
           -- the per-profile claim decision mutually exclusive (see doc above).
           AND pg_try_advisory_xact_lock(hashtext(j.profile_name))
         ORDER BY j.id ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING *`,
    [String(LEASE_MINUTES)]
  );
  return (res.rows[0] as CampaignJob) ?? null;
}

/**
 * Append one BatchEvent into events[], recompute counts from run_state, persist
 * the (already-mutated-by-caller) run_state, and extend the lease so a healthy
 * long run isn't stolen. Mirrors updateJobProgress in sync-jobs.ts.
 */
export async function appendJobEvent(
  id: number,
  event: BatchEvent,
  runState: BatchRunState,
  counts: JobCounts
): Promise<void> {
  await pool.query(
    `UPDATE campaign_jobs SET
        events = events || $2::jsonb,
        run_state = $3::jsonb,
        counts = $4::jsonb,
        leased_until = now() + ($5 || ' minutes')::interval
      WHERE id = $1`,
    [
      id,
      JSON.stringify([event]),
      JSON.stringify(runState),
      JSON.stringify(counts),
      String(LEASE_MINUTES),
    ]
  );
}

/** Persist run_state/counts without an event (e.g. after media checkpoints). */
export async function saveJobProgress(
  id: number,
  runState: BatchRunState,
  counts: JobCounts
): Promise<void> {
  await pool.query(
    `UPDATE campaign_jobs SET
        run_state = $2::jsonb,
        counts = $3::jsonb,
        leased_until = now() + ($4 || ' minutes')::interval
      WHERE id = $1`,
    [id, JSON.stringify(runState), JSON.stringify(counts), String(LEASE_MINUTES)]
  );
}

/**
 * Persist run_state/counts on a budget pause and RELEASE the lease so the very
 * next tick can resume immediately. Status stays 'running'; leased_until is
 * cleared (NULL). Mirrors advanceAndRelease() in lib/sync-jobs.ts.
 *
 * Without this, a budget abort would leave the fresh 20-minute lease that the
 * preceding appendJobEvent/saveJobProgress wrote, and claimNextCampaignJob only
 * treats a running job as runnable when its lease is NULL or expired — so the
 * 2-minute cron would not be able to resume the job for ~18 minutes.
 */
export async function releaseLeaseForResume(
  id: number,
  runState: BatchRunState,
  counts: JobCounts
): Promise<void> {
  await pool.query(
    `UPDATE campaign_jobs SET
        run_state = $2::jsonb,
        counts = $3::jsonb,
        leased_until = NULL
      WHERE id = $1`,
    [id, JSON.stringify(runState), JSON.stringify(counts)]
  );
}

/** Mark a job finished. Releases the lease. status ∈ done|done_with_errors|error|cancelled. */
export async function finishJob(
  id: number,
  status: 'done' | 'done_with_errors' | 'error' | 'cancelled',
  error?: string
): Promise<void> {
  await pool.query(
    `UPDATE campaign_jobs SET
        status = $2,
        error = $3,
        finished_at = now(),
        leased_until = NULL
      WHERE id = $1`,
    [id, status, error ? error.slice(0, 1000) : null]
  );
}

/**
 * Request cancellation.
 *  - pending → flip to 'cancelled' immediately (it never started).
 *  - running → set cancel_requested = true; the worker stops at the next entity.
 *  - terminal (done/error/cancelled/done_with_errors) → no-op.
 * Returns the resulting outcome so the route can choose 200 vs 409.
 *
 * Implementation note: a plain UPDATE … RETURNING cannot distinguish "this call
 * just flipped pending→cancelled" from "the job was ALREADY cancelled before this
 * call" — both would show status='cancelled' in RETURNING. We use a CTE to capture
 * the old status BEFORE the mutation so the classification is exact. Concretely:
 *
 *   WITH prev AS (SELECT status FROM campaign_jobs WHERE id=$1 FOR UPDATE)
 *   UPDATE … FROM prev … RETURNING prev.status AS old_status, …new status…
 *
 * The FOR UPDATE inside the CTE serializes concurrent cancel calls on the same row:
 * whichever call acquires the row lock first sees status='pending' (old_status) and
 * returns 'cancelled'; the second call sees old_status='cancelled' (already flipped
 * by the first) and correctly returns 'not_cancellable'. Without FOR UPDATE two
 * simultaneous cancels (double-click, two tabs) could both read status='pending'
 * from the CTE and both return 'cancelled'.
 */
export async function requestCancel(
  id: number
): Promise<'cancelled' | 'cancel_requested' | 'not_cancellable' | 'not_found'> {
  await ensureCampaignJobsTable();
  const res = await pool.query(
    `WITH prev AS (
       SELECT status FROM campaign_jobs WHERE id = $1 FOR UPDATE
     )
     UPDATE campaign_jobs SET
         status         = CASE WHEN prev.status = 'pending' THEN 'cancelled' ELSE campaign_jobs.status END,
         cancel_requested = CASE WHEN prev.status = 'running' THEN TRUE ELSE campaign_jobs.cancel_requested END,
         finished_at    = CASE WHEN prev.status = 'pending' THEN now() ELSE campaign_jobs.finished_at END
       FROM prev
       WHERE campaign_jobs.id = $1
       RETURNING prev.status AS old_status, campaign_jobs.cancel_requested`,
    [id]
  );
  const row = res.rows[0];
  if (!row) return 'not_found';
  // Only report 'cancelled' when THIS call actually performed the pending→cancelled
  // flip (old_status was 'pending'). An already-cancelled job returns 'not_cancellable'
  // so the route correctly returns 409 instead of a false-success 200.
  if (row.old_status === 'pending') return 'cancelled';
  if (row.cancel_requested) return 'cancel_requested';
  return 'not_cancellable';
}

export interface ListJobsFilters {
  status?: string;
  profile?: string;
  active?: boolean; // pending OR running
  limit?: number;
  before_id?: number;
}

/** List jobs (newest first) WITHOUT the heavy payload column. */
export async function listJobs(
  filters: ListJobsFilters = {}
): Promise<CampaignJobListRow[]> {
  await ensureCampaignJobsTable();
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.active) {
    where.push(`status IN ('pending','running')`);
  } else if (filters.status) {
    params.push(filters.status);
    where.push(`status = $${params.length}`);
  }
  if (filters.profile) {
    params.push(filters.profile);
    where.push(`profile_name = $${params.length}`);
  }
  if (filters.before_id) {
    params.push(filters.before_id);
    where.push(`id < $${params.length}`);
  }
  // clampListLimit (pure, unit-tested) handles the NaN case: ?limit=abc →
  // Number('abc') = NaN, which nullish-coalescing would NOT catch and which would
  // bind a NaN LIMIT that Postgres rejects → a 500 on a malformed query string.
  const limit = clampListLimit(filters.limit);
  params.push(limit);
  const sql =
    `SELECT ${ALL_COLUMNS_NO_PAYLOAD} FROM campaign_jobs` +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ` ORDER BY id DESC LIMIT $${params.length}`;
  const res = await pool.query(sql, params);
  return res.rows as CampaignJobListRow[];
}

/** Full job row including payload. */
export async function getJob(id: number): Promise<CampaignJob | null> {
  await ensureCampaignJobsTable();
  const res = await pool.query(`SELECT * FROM campaign_jobs WHERE id = $1`, [id]);
  return (res.rows[0] as CampaignJob) ?? null;
}

// ────────────────────────────────────────────────────────────────────────────
// Worker loop
// ────────────────────────────────────────────────────────────────────────────

/** Outcome of the media-resolution phase. */
type MediaResolveResult =
  // All Drive media resolved (or none present): proceed to runBatch.
  | { kind: 'done' }
  // Time budget ran out (Date.now()-startedAtMs > budgetMs): leave the job
  // 'running', lease released, resumable from the m:<idx> checkpoints already
  // persisted. The tick may immediately re-drain if budget remains for OTHER
  // profiles' jobs.
  | { kind: 'paused-budget'; reason: string }
  // A TRANSIENT download/upload error (Meta #4/#17 throttle, 429, 5xx, network
  // blip) with budget still remaining. Leave the job 'running', lease released,
  // resumable — but the caller must YIELD out of the tick so a LATER cron tick
  // provides natural backoff. Re-claiming in the same tick would busy-retry the
  // very endpoint that is throttling (review fix #1). `reason` is for the log.
  | { kind: 'paused-transient'; reason: string }
  // Cancel was requested mid-media: stop and let the caller finish 'cancelled'.
  | { kind: 'cancelled' }
  // A PERMANENT failure (bad mime, invalid token, corrupt bytes, non-transient
  // Meta error): the caller finishes the job 'error'.
  | { kind: 'error'; message: string };

/**
 * Resolve Drive-sourced creative media BEFORE running the batch: download from
 * Drive, upload to Meta, checkpoint the resulting image_hash/video_id in
 * run_state.created under key `m:<creativeIdx>` so a resumed run never
 * re-downloads. Rewrites the payload creatives in place to source 'meta'.
 *
 * Budget/abort awareness (review fix #1): the media phase runs OUTSIDE runBatch
 * and each item costs a Drive download + Meta upload + up to ~30s thumbnail poll.
 * Several Drive videos can blow past the 270s tick budget AND the 300s Cloud Run
 * wall before runBatch is ever reached. We therefore check shouldAbort()/cancel
 * at the TOP of every iteration. On a budget/cancel pause we return WITHOUT
 * writing a fresh lease — the caller releases the lease so the next 2-minute tick
 * resumes immediately instead of waiting out a ~20-minute lease.
 *
 * Transient vs permanent (review fix #2): a network blip, Meta #4/#17 throttle,
 * or 5xx on creative N is TRANSIENT — creatives 0..N-1 are already uploaded and
 * checkpointed, so we PAUSE (resumable) instead of failing the whole job. Only a
 * positively-permanent failure terminates the job. Mirrors how runBatch treats
 * the BatchEvent `permanent` flag.
 */
async function resolveDriveMedia(
  job: CampaignJob,
  runState: BatchRunState,
  persist: () => Promise<void>,
  shouldAbort: () => boolean,
  isCancelRequested: () => Promise<boolean>
): Promise<MediaResolveResult> {
  const creatives: any[] = Array.isArray(job.payload?.batch?.creatives)
    ? job.payload.batch.creatives
    : Array.isArray(job.payload?.creatives)
      ? job.payload.creatives
      : [];

  for (let idx = 0; idx < creatives.length; idx++) {
    const c = creatives[idx];
    const media: CreativeMedia | undefined = c?.media;
    if (!media || media.source !== 'drive') continue;

    const checkpointKey = `m:${idx}`;
    const already = runState.created[checkpointKey];
    if (already) {
      // Resume: we already uploaded this on a prior tick. The stored value is
      // "img:<hash>" or "vid:<video_id>"; rewrite the slot from the checkpoint.
      applyMediaCheckpoint(c, media, already);
      continue;
    }

    // Budget/cancel gate BEFORE starting this item's download+upload+thumbnail
    // poll (each can take tens of seconds). Checked here, not mid-upload, so we
    // never leave a half-uploaded item without a checkpoint.
    if (await isCancelRequested()) return { kind: 'cancelled' };
    if (shouldAbort()) {
      return { kind: 'paused-budget', reason: `Budget de tempo atingido na mídia ${idx}` };
    }

    try {
      const meta = await getDriveFileMeta(media.file_id);
      const buf = await downloadDriveFile(media.file_id);
      const bytes = new Uint8Array(buf);
      const isVideo = (media.mime || meta.mimeType || '').startsWith('video/');

      if (isVideo) {
        const { video_id, thumbnail_url } = await uploadVideo(
          job.account_id,
          currentToken(job),
          media.filename || meta.name,
          bytes,
          media.mime || meta.mimeType
        );
        runState.created[checkpointKey] = `vid:${video_id}${thumbnail_url ? `|${thumbnail_url}` : ''}`;
        c.media = {
          source: 'meta',
          video_id,
          video_thumbnail_url: thumbnail_url,
          filename: media.filename || meta.name,
        };
      } else {
        const { hash } = await uploadImage(
          job.account_id,
          currentToken(job),
          media.filename || meta.name,
          bytes,
          media.mime || meta.mimeType
        );
        runState.created[checkpointKey] = `img:${hash}`;
        c.media = {
          source: 'meta',
          image_hash: hash,
          filename: media.filename || meta.name,
        };
      }
      // Checkpoint this item before moving on (also extends the lease).
      await persist();
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message ?? String(e);
      if (isTransientMediaError(e)) {
        // Transient: creatives 0..idx-1 stay checkpointed. Pause (resumable) so a
        // LATER cron tick retries ONLY this item — NOT this tick. Do not extend the
        // lease (caller releases it), but signal 'paused-transient' so the caller
        // yields out of the tick loop. Re-claiming this same job within the current
        // tick (lease NULL → runnable, lowest id, no live run) would tight-loop on
        // the exact endpoint that is throttling, worsening the throttle (review fix
        // #1). The 2-minute cron cadence is the natural backoff.
        return { kind: 'paused-transient', reason: `Erro transitório na mídia ${idx}: ${msg}` };
      }
      // Permanent: terminate the job.
      return { kind: 'error', message: `Falha ao preparar mídia ${idx}: ${msg}` };
    }
  }
  return { kind: 'done' };
}

function applyMediaCheckpoint(
  creative: any,
  original: { filename?: string },
  stored: string
): void {
  if (stored.startsWith('img:')) {
    creative.media = {
      source: 'meta',
      image_hash: stored.slice(4),
      filename: original.filename,
    };
  } else if (stored.startsWith('vid:')) {
    // The checkpoint is written as `vid:${video_id}|${thumbnail_url}`. Split on the
    // FIRST '|' only — NOT rest.split('|') which silently discards anything after the
    // first delimiter (review fix). Meta CDN thumbnail URLs carry query strings and,
    // while '|' is not RFC-valid unencoded, it is not guaranteed absent from a signed
    // CDN URL; a '|' inside the URL (or any future change to the stored format) would
    // otherwise corrupt the thumbnail on resume WITHOUT error. video_id is everything
    // before the first '|'; the thumbnail is everything after it (which itself may
    // contain further '|').
    const rest = stored.slice(4);
    const sep = rest.indexOf('|');
    const video_id = sep === -1 ? rest : rest.slice(0, sep);
    const thumb = sep === -1 ? '' : rest.slice(sep + 1);
    creative.media = {
      source: 'meta',
      video_id,
      video_thumbnail_url: thumb || undefined,
      filename: original.filename,
    };
  }
}

/** The Meta token frozen into the payload at enqueue time. */
function currentToken(job: CampaignJob): string {
  return (
    job.payload?.access_token ??
    job.payload?.batch?.access_token ??
    ''
  );
}

/**
 * Normalize a job's stored payload into the TOP-LEVEL shape createCampaignBatch
 * (BatchCreateInput) destructures — review fix #2. Delegates to the pure,
 * unit-tested normalizeBatchInput in ./campaign-jobs-core. For batch-shaped jobs
 * it flattens payload.batch (campaign/adset/creatives/campaigns_per_creative/…)
 * up to the top level so runBatch no longer sees undefined; legacy/flat payloads
 * pass through. Called AFTER resolveDriveMedia so the in-place drive→meta media
 * rewrites inside payload.batch.creatives are already applied when we flatten.
 */
function buildBatchInput(job: CampaignJob): any {
  return normalizeBatchInput(job.payload);
}

/**
 * Process one claimed job to completion, abort, or finish-with-errors.
 * Returns:
 *  - 'finished' — the job reached a terminal state this call.
 *  - 'budget'   — left 'running' (lease released) because the TIME budget ran out;
 *                 the tick may keep draining OTHER profiles' jobs while budget lasts.
 *  - 'yield'    — left 'running' (lease released) because of a TRANSIENT throttle
 *                 with budget remaining; the caller MUST stop draining this tick so
 *                 a later cron tick backs off (review fix #1). Re-claiming now would
 *                 busy-retry the throttled endpoint.
 */
async function processJob(
  job: CampaignJob,
  startedAtMs: number,
  budgetMs: number
): Promise<'finished' | 'budget' | 'yield'> {
  const runState: BatchRunState = job.run_state ?? { created: {}, failed: {} };
  if (!runState.created) runState.created = {};
  if (!runState.failed) runState.failed = {};
  let counts: JobCounts = job.counts ?? {
    created: 0,
    failed: 0,
    skipped: 0,
    total: 0,
  };
  // Reset the skipped baseline to 0 for THIS run. skipped is not stored in
  // run_state, so on a budget-abort resume job.counts.skipped already holds the
  // prior tick's skips; the orchestrator re-emits skipped events for entities it
  // re-skips on resume, which would otherwise inflate the running count (and the
  // value we persist mid-run via appendJobEvent). The authoritative
  // result.counts.skipped at the end reflects only the current run, so the live
  // per-run baseline must also start at 0 to match. created/failed/total are
  // derived from run_state (carried forward) and are unaffected.
  counts = { ...counts, skipped: 0 };

  let cancelRequested = job.cancel_requested;
  let eventsSinceCancelCheck = 0;

  const shouldAbort = (): boolean => {
    if (cancelRequested) return true;
    if (Date.now() - startedAtMs > budgetMs) return true;
    return false;
  };

  // 1) Resolve Drive media up front (checkpointed so resume skips it). This phase
  // runs OUTSIDE runBatch, so it must honor the SAME budget/cancel walls — a job
  // with several Drive videos could otherwise exceed the 270s tick budget and the
  // 300s Cloud Run wall before runBatch is even reached, leaving the job 'running'
  // with a live 20-minute lease that stalls the queue (review fix #1). Transient
  // download/upload failures pause-for-resume instead of failing terminally
  // (review fix #2).
  const media = await resolveDriveMedia(
    job,
    runState,
    () => saveJobProgress(job.id, runState, counts),
    shouldAbort,
    async () => {
      cancelRequested = cancelRequested || (await readCancelRequested(job.id));
      return cancelRequested;
    }
  );
  if (media.kind === 'cancelled') {
    await finishJob(job.id, 'cancelled');
    return 'finished';
  }
  if (media.kind === 'error') {
    await finishJob(job.id, 'error', media.message);
    return 'finished';
  }
  if (media.kind === 'paused-budget') {
    // Time budget ran out mid-media: persist the m:<idx> checkpoints and RELEASE
    // the lease so the next cron tick resumes immediately (without this, the last
    // saveJobProgress' fresh 20-minute lease would make claimNextCampaignJob skip
    // the job for ~18 minutes — the exact stall the review flagged). Status stays
    // 'running'. 'budget' lets the tick keep draining other profiles' jobs.
    await releaseLeaseForResume(job.id, runState, counts);
    return 'budget';
  }
  if (media.kind === 'paused-transient') {
    // Transient throttle/blip with budget still remaining: persist checkpoints and
    // RELEASE the lease (resumable), but signal 'yield' so runQueueTick STOPS
    // draining this tick. The job is now runnable (lease NULL, lowest id, no live
    // run for its profile); if we kept looping we would immediately re-claim it and
    // tight-loop on the throttled endpoint within this tick, hammering the very
    // Meta call that is rate-limiting us (review fix #1). The ~2-minute cron cadence
    // is the natural backoff; a later tick retries ONLY this item from its m:<idx>
    // checkpoint.
    await releaseLeaseForResume(job.id, runState, counts);
    return 'yield';
  }

  const onEvent = async (e: BatchEvent): Promise<void> => {
    counts = reduceCounts(runState, counts, e);
    await appendJobEvent(job.id, e, runState, counts);
    // Periodically re-read cancel_requested so an in-flight job reacts to cancel.
    eventsSinceCancelCheck++;
    if (eventsSinceCancelCheck >= CANCEL_RECHECK_EVERY) {
      eventsSinceCancelCheck = 0;
      cancelRequested = await readCancelRequested(job.id);
    }
  };

  // Normalize the stored payload into the top-level shape runBatch destructures.
  // For batch-shaped jobs this flattens payload.batch (campaign/adset/creatives/
  // campaigns_per_creative/…) up to the top level; otherwise it passes through.
  // Done AFTER resolveDriveMedia so the in-place media rewrites (drive→meta) inside
  // payload.batch.creatives are already applied (review fix #2).
  const batchInput = buildBatchInput(job);

  let result: { aborted: boolean; counts: { created: number; failed: number; skipped: number } };
  try {
    result = await runBatch(batchInput, {
      onEvent,
      runState,
      shouldAbort,
    });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    await finishJob(job.id, 'error', msg);
    return 'finished';
  }

  // Final counts straight from the orchestrator result (authoritative).
  counts = {
    created: result.counts.created,
    failed: result.counts.failed,
    skipped: result.counts.skipped,
    total: counts.total,
  };
  await saveJobProgress(job.id, runState, counts);

  if (result.aborted) {
    // Re-read once more: distinguish cancel-abort from budget-abort.
    cancelRequested = cancelRequested || (await readCancelRequested(job.id));
    if (cancelRequested) {
      await finishJob(job.id, 'cancelled');
      return 'finished';
    }
    // Budget abort: leave status 'running' but RELEASE the lease (leased_until =
    // NULL) so the very next 2-minute cron tick can resume from run_state. The
    // saveJobProgress above (and every appendJobEvent during the run) wrote a
    // fresh 20-minute lease; we must clear it here, otherwise claimNextCampaignJob
    // would not consider the job runnable until that lease expired (~18 min late).
    await releaseLeaseForResume(job.id, runState, counts);
    return 'budget';
  }

  const status = result.counts.failed > 0 ? 'done_with_errors' : 'done';
  await finishJob(job.id, status);
  return 'finished';
}

async function readCancelRequested(id: number): Promise<boolean> {
  const res = await pool.query(
    `SELECT cancel_requested FROM campaign_jobs WHERE id = $1`,
    [id]
  );
  return Boolean(res.rows[0]?.cancel_requested);
}

/**
 * Drain the queue within a time budget. Claims runnable jobs one at a time
 * (per-Profile serialization is enforced by the claim) and processes each until
 * the budget runs out. Shared by the cron poller and the browser kick route.
 *
 * Returns how many jobs it claimed and how many reached a terminal state.
 */
export async function runQueueTick(
  budgetMs: number = DEFAULT_BUDGET_MS
): Promise<{ claimed: number; finished: number }> {
  const startedAtMs = Date.now();
  let claimed = 0;
  let finished = 0;

  while (Date.now() - startedAtMs < budgetMs) {
    const job = await claimNextCampaignJob();
    if (!job) break; // nothing runnable right now
    claimed++;
    const outcome = await processJob(job, startedAtMs, budgetMs);
    if (outcome === 'finished') finished++;
    // 'yield' = a TRANSIENT throttle paused this job with budget still remaining.
    // We MUST stop draining now: the job was just released (lease NULL) and is the
    // lowest-id runnable row for its profile, so the next claimNextCampaignJob would
    // immediately re-claim it and busy-retry the throttled endpoint until the budget
    // expires — hammering the very Meta call that is rate-limiting us (review fix
    // #1). The ~2-minute cron cadence is the backoff; the next tick resumes it.
    if (outcome === 'yield') break;
    // 'budget' = the TIME budget ran out for THIS job. The job stays 'running'
    // (lease released) for the next tick. We keep looping: either the top-of-loop
    // budget check fails and we exit, or budget remains and another profile has
    // work we can still drain this tick.
  }

  return { claimed, finished };
}
