// Pure helpers for the campaign queue: the claim predicate and the
// event→counts reducer. Kept in a dependency-free module (no DB, no Meta, no
// path aliases) so they're unit-testable in isolation — importing the main
// lib/campaign-jobs.ts pulls in lib/meta-campaigns.ts whose `@/` aliases vitest
// can't resolve. lib/campaign-jobs.ts re-exports everything here.

import type { BatchRunState, BatchEvent } from './batch-contract';

export type CampaignJobStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'done_with_errors'
  | 'error'
  | 'cancelled';

export interface JobCounts {
  created: number;
  failed: number;
  skipped: number;
  total: number;
}

export interface RunnableJobView {
  id: number;
  status: CampaignJobStatus;
  profile_name: string;
  leased_until: number | null; // epoch ms, or null
}

/**
 * Pure mirror of the SQL claim predicate, for tests. Given the full set of jobs
 * and the current time, returns the id of the next job claimNextCampaignJob would
 * pick, or null. A pending job is blocked iff ANOTHER job of the same profile is
 * 'running' with an unexpired lease. A running job with an expired/null lease is
 * itself runnable (crash resume). FIFO by id.
 */
export function pickRunnableJobId(
  jobs: RunnableJobView[],
  nowMs: number
): number | null {
  const profileHasLiveRun = (profile: string): boolean =>
    jobs.some(
      (r) =>
        r.profile_name === profile &&
        r.status === 'running' &&
        r.leased_until !== null &&
        r.leased_until > nowMs
    );

  const runnable = jobs.filter((j) => {
    if (j.status === 'pending') {
      return !profileHasLiveRun(j.profile_name);
    }
    if (j.status === 'running') {
      // `<=` (NOT `<`) is the faithful mirror of the SQL claim at the tick
      // boundary (review fix). In SQL, now() is ONE transaction timestamp:
      // the live-run blocker uses `r.leased_until > now()` and the running-
      // resume branch uses `j.leased_until <= now()`. At leased_until == now()
      // a running row must therefore be BOTH "not a live-run blocker" (strict
      // `>` above is false) AND "itself runnable" (resume). A strict `<` here
      // would, at exact equality, make the running row neither a blocker NOR
      // runnable — a state Postgres's single now() cannot produce, so the
      // model would diverge from the SQL at precisely the boundary it claims
      // to model. With `<=` the equality case mirrors SQL exactly: an
      // expired-or-exactly-now lease is resumable. (The SQL's running-resume
      // predicate is correspondingly `<=` — see buildClaimSql in
      // lib/campaign-jobs.ts.)
      return j.leased_until === null || j.leased_until <= nowMs;
    }
    return false;
  });

  if (runnable.length === 0) return null;
  runnable.sort((a, b) => a.id - b.id);
  return runnable[0].id;
}

/**
 * Recompute counts from a run_state. created/failed are the sizes of the
 * respective maps (excluding media-only `m:` checkpoint keys, which aren't ad
 * entities).
 *
 * `skipped` is NOT stored in run_state, so it is accumulated from `prior.skipped`
 * as skipped events arrive. IMPORTANT: this accumulation is only correct WITHIN a
 * single processJob run. The caller MUST reset the skipped baseline to 0 at the
 * start of each run (processJob does — see `counts.skipped = 0` there). Otherwise a
 * budget-abort resume would double-count: the persisted job.counts.skipped already
 * includes the prior tick's skips, and the orchestrator re-emits skipped events for
 * entities it re-skips on resume. Because each run's authoritative
 * result.counts.skipped reflects only that run, the live per-run baseline must also
 * start at 0 to stay consistent with it.
 *
 * `total` has no channel in BatchRunResult, so we DERIVE it from observed entities:
 * total = distinct entities created + failed + skipped so far. This is a live,
 * monotonically-growing denominator (never the permanent 0 it used to seed), so the
 * progress UI shows created/failed against a real total instead of /0. We take the
 * max with `prior.total` so an aborted-and-resumed run never regresses the
 * denominator the user already saw, even though `skipped` resets per run.
 */
/**
 * Clamp a requested list page size into [1, 200], defaulting to 50.
 *
 * Defensive against NaN: the list route does `?limit=abc → Number('abc') = NaN`,
 * and nullish-coalescing (`?? 50`) does NOT catch NaN. Without the Number.isFinite
 * gate, NaN would survive Math.min(Math.max(1, NaN), 200) = NaN and bind a NaN
 * LIMIT, which Postgres rejects → a trivially malformed query string would 500
 * instead of falling back to the default page size. Non-integers are floored so
 * the bound is always a clean integer for `LIMIT $n`.
 */
export function clampListLimit(
  raw: number | undefined,
  def = 50,
  max = 200
): number {
  const n = Number.isFinite(raw as number) ? Math.floor(raw as number) : def;
  return Math.min(Math.max(1, n), max);
}

/**
 * Meta error codes that are TRANSIENT for a media upload (retry/resume worthwhile),
 * mirroring TRANSIENT_FB_CODES in lib/meta-campaigns.ts:
 *   1 (unknown/temporary), 2 (service unavailable), 4 (app request limit),
 *   17 (user request limit), 341 (temporary limit), 368 (temporary block),
 *   80004 (too many calls to ad account). HTTP 429 and 5xx are transient too.
 *
 * We duplicate the set here (instead of importing) on purpose: this module is
 * kept dependency-free so it stays unit-testable, and meta-campaigns.ts does NOT
 * export MetaApiError / isTransientError. We therefore DUCK-TYPE the thrown error
 * — a MetaApiError carries `name === 'MetaApiError'`, a numeric `fbCode` and a
 * numeric `httpStatus` (see lib/meta-campaigns.ts). Anything we cannot positively
 * classify as transient is treated as PERMANENT, so a genuinely broken upload
 * (bad mime, corrupt bytes, invalid token) still fails the job fast rather than
 * spinning forever.
 */
export const TRANSIENT_MEDIA_FB_CODES = new Set([1, 2, 4, 17, 341, 368, 80004]);

/**
 * True when a media download/upload error is worth resuming on a later tick
 * (network blip, Meta #4/#17 throttle, transient 5xx) rather than failing the
 * whole job terminally. Mirrors isTransientError() in lib/meta-campaigns.ts but
 * works by structural duck-typing because MetaApiError is not exported.
 */
export function isTransientMediaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as {
    name?: unknown;
    fbCode?: unknown;
    httpStatus?: unknown;
    code?: unknown;
  };
  const fbCode = typeof e.fbCode === 'number' ? e.fbCode : undefined;
  if (fbCode !== undefined && TRANSIENT_MEDIA_FB_CODES.has(fbCode)) return true;
  const http = typeof e.httpStatus === 'number' ? e.httpStatus : undefined;
  if (http === 429) return true;
  if (http !== undefined && http >= 500 && http <= 599) return true;
  // Bare network-layer failures (fetch DNS/connection reset / abort) surface as
  // a TypeError or an Error with a Node errno code, never a MetaApiError. Those
  // are transient — the Drive download or the Meta POST never reached a verdict.
  if (e.name === 'MetaApiError') return false; // had a verdict, not transient per above
  const code = typeof e.code === 'string' ? e.code : undefined;
  if (code && /ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|ECONNRESET|UND_ERR/i.test(code)) {
    return true;
  }
  if (e.name === 'TypeError' || e.name === 'AbortError') return true; // fetch failed before a response
  return false;
}

/**
 * Normalize a job's stored payload into the TOP-LEVEL shape createCampaignBatch
 * (BatchCreateInput) destructures — review fix #2.
 *
 * create/route.ts builds `payload = { ...body, account_id, access_token,
 * profile_name, separation_level, frozen_context, ... }`. For a BATCH request,
 * `body` carries a NESTED `batch:{ campaign, adset, creatives,
 * campaigns_per_creative, page_ids, ... }` and NOT top-level campaign/adset/
 * creatives, whereas createCampaignBatch reads input.campaign / input.adset /
 * input.creatives / input.campaigns_per_creative at the TOP level. Passing the raw
 * payload would leave all of those undefined, so a batch-mode job would create
 * nothing / throw. We FLATTEN payload.batch onto the top level, keeping the
 * worker-injected fields (account_id, access_token, frozen_context,
 * separation_level) authoritative so the frozen token/clock are never shadowed by
 * anything inside batch. The `batch` key itself is dropped.
 *
 * Legacy (non-batch) payloads carry campaign/adset at the top level and have no
 * `batch` key, so they pass through unchanged.
 *
 * Kept here (dependency-free) so it is unit-testable; lib/campaign-jobs.ts uses it
 * AFTER resolveDriveMedia, so the in-place drive→meta media rewrites inside
 * payload.batch.creatives are already applied when we flatten.
 */
export function normalizeBatchInput(payload: any): any {
  const p = payload ?? {};
  const batch = p.batch;
  if (!batch || typeof batch !== 'object') {
    return p; // legacy / already-flat: nothing nested to unwrap
  }
  const { batch: _omit, ...top } = p;
  return {
    ...batch,
    ...top, // worker-injected/top-level fields win over stale duplicates in batch
    separation_level: top.separation_level ?? batch.separation_level,
  };
}

export function reduceCounts(
  runState: BatchRunState,
  prior: JobCounts,
  event?: BatchEvent
): JobCounts {
  const isEntityKey = (k: string) => !k.startsWith('m:');
  const created = Object.keys(runState.created).filter(isEntityKey).length;
  const failed = Object.keys(runState.failed).filter(isEntityKey).length;
  const skipped =
    event && event.kind === 'skipped' ? prior.skipped + 1 : prior.skipped;
  const total = Math.max(prior.total, created + failed + skipped);
  return { created, failed, skipped, total };
}

// ────────────────────────────────────────────────────────────────────────────
// SQL builders + outcome classifiers (review fix #3)
//
// These were previously inline template literals in lib/campaign-jobs.ts, and the
// only "tests" for the most load-bearing guarantees (advisory-lock race safety,
// CTE double-cancel correctness, transaction atomicity) were readFileSync +
// string-match assertions over that file — spell-checkers, not behavioral tests:
// they passed even if the logic was broken and broke on harmless reformatting.
//
// Extracting the query text into pure, exported builders here (dependency-free, so
// vitest can import them without pulling in meta-campaigns.ts's `@/` aliases) lets
// the test suite assert against the ACTUAL SQL the production code runs — and the
// pure decision logic (cancel classification, enqueue plan) against real inputs —
// instead of the bytes of the source file. lib/campaign-jobs.ts now calls these
// builders, so a refactor that changes behavior changes the builder output and the
// tests catch it; a cosmetic reformat of campaign-jobs.ts does not.
// ────────────────────────────────────────────────────────────────────────────

/**
 * The single UPDATE…RETURNING that atomically claims the next runnable job with
 * race-safe per-Profile FIFO serialization. $1 is the lease length in minutes.
 *
 * Race safety rests on two primitives that MUST both be present:
 *   - pg_try_advisory_xact_lock(hashtext(profile_name)) as the LAST conjunct, so a
 *     second concurrent tick cannot claim a different pending job for the same
 *     profile before the first tick's status='running' flip is visible.
 *   - FOR UPDATE SKIP LOCKED, so concurrent ticks never block on / re-grab the same
 *     candidate row.
 * The running-resume branch uses `<= now()` (matches pickRunnableJobId's `<=`): an
 * expired-or-exactly-now lease is resumable; the live-run blocker uses strict
 * `> now()`.
 */
export function buildClaimSql(): string {
  return `UPDATE campaign_jobs SET
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
               AND (j.leased_until IS NULL OR j.leased_until <= now())
             )
           )
           -- LAST conjunct on purpose: only acquired for rows that already passed
           -- the predicates above. Held by this claim's tx until commit, making
           -- the per-profile claim decision mutually exclusive.
           AND pg_try_advisory_xact_lock(hashtext(j.profile_name))
         ORDER BY j.id ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING *`;
}

/**
 * The CTE-based cancel statement. $1 is the job id. The `prev` CTE captures
 * old_status BEFORE the mutation (locked FOR UPDATE so concurrent double-cancels
 * serialize), so the caller can tell "this call just cancelled" from "was already
 * cancelled". Returns prev.status AS old_status + the post-update cancel_requested.
 */
export function buildCancelSql(): string {
  return `WITH prev AS (
       SELECT status FROM campaign_jobs WHERE id = $1 FOR UPDATE
     )
     UPDATE campaign_jobs SET
         status         = CASE WHEN prev.status = 'pending' THEN 'cancelled' ELSE campaign_jobs.status END,
         cancel_requested = CASE WHEN prev.status = 'running' THEN TRUE ELSE campaign_jobs.cancel_requested END,
         finished_at    = CASE WHEN prev.status = 'pending' THEN now() ELSE campaign_jobs.finished_at END
       FROM prev
       WHERE campaign_jobs.id = $1
       RETURNING prev.status AS old_status, campaign_jobs.cancel_requested`;
}

export type CancelOutcome =
  | 'cancelled'
  | 'cancel_requested'
  | 'not_cancellable'
  | 'not_found';

/**
 * Classify the cancel SQL's RETURNING row into the route-facing outcome. PURE so it
 * is directly unit-testable: feed it the {old_status, cancel_requested} the CTE
 * returns (or undefined for a missing row) and assert the verdict.
 *
 *  - no row            → 'not_found'
 *  - old_status pending → 'cancelled'  (THIS call performed pending→cancelled)
 *  - else cancel_requested true → 'cancel_requested' (running job flagged)
 *  - else              → 'not_cancellable' (already terminal / already cancelled)
 *
 * The "already cancelled" job has old_status='cancelled' (not 'pending') and
 * cancel_requested=false, so it correctly yields 'not_cancellable' → the route
 * returns 409 instead of a false-success 200.
 */
export function classifyCancelOutcome(
  row: { old_status?: string; cancel_requested?: boolean } | undefined
): CancelOutcome {
  if (!row) return 'not_found';
  if (row.old_status === 'pending') return 'cancelled';
  if (row.cancel_requested) return 'cancel_requested';
  return 'not_cancellable';
}

/**
 * Decide whether to STOP draining the tick or KEEP going after processing one job.
 * PURE mirror of the loop control in runQueueTick: a transient throttle ('yield')
 * must break the loop (so a later cron tick provides backoff and we don't busy-
 * retry the throttled Meta endpoint by immediately re-claiming the just-released
 * job); 'finished'/'budget' keep draining. Extracted so the yield-vs-continue
 * decision has real behavioral coverage instead of a source-text grep.
 */
export function shouldContinueDraining(
  outcome: 'finished' | 'budget' | 'yield'
): boolean {
  return outcome !== 'yield';
}

/**
 * Decode a `vid:` media checkpoint stored as `vid:${video_id}|${thumbnail_url}`.
 * PURE so it is directly unit-testable; applyMediaCheckpoint in lib/campaign-jobs.ts
 * calls this exact function (review fix #3 — no replicated decode to drift).
 *
 * Splits on the FIRST '|' via indexOf, NOT rest.split('|'), so the thumbnail keeps
 * everything after the first delimiter intact. A Meta CDN signed thumbnail URL is
 * not guaranteed free of '|' (query strings), and the lossy `[video_id, thumb] =
 * rest.split('|')` form silently DISCARDED anything after the first delimiter,
 * corrupting the thumbnail on resume WITHOUT error.
 */
export function decodeVidCheckpoint(stored: string): {
  video_id: string;
  thumbnail_url: string | undefined;
} {
  const rest = stored.slice(4); // drop the "vid:" prefix
  const sep = rest.indexOf('|');
  const video_id = sep === -1 ? rest : rest.slice(0, sep);
  const thumb = sep === -1 ? '' : rest.slice(sep + 1);
  return { video_id, thumbnail_url: thumb || undefined };
}

// Minimal client surface the enqueue transaction needs — exactly what a pooled pg
// client exposes. Dependency-injected so the transaction logic is unit-testable
// with a fake client (review fix #3) instead of only verifiable by reading source.
export interface TxClient {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

export interface EnqueueRow {
  profile_name: string;
  account_id: string;
  account_name?: string | null;
  payload: unknown;
}

/**
 * Insert N campaign jobs ATOMICALLY on one client: BEGIN, one INSERT per job,
 * COMMIT — or ROLLBACK and rethrow if ANY insert fails. PURE w.r.t. the DB driver
 * (it only touches the injected client), so a fake client can assert the all-or-
 * nothing contract behaviorally (review fix #3): a mid-loop failure must ROLLBACK
 * and surface the error so NO partial subset of a multi-account broadcast commits.
 * Without this, a partial commit + a user retry would double-enqueue the already-
 * inserted accounts → duplicate real campaigns (double-spend). The caller leases the
 * client from the pool and releases it in finally; the COMMIT/ROLLBACK live here.
 */
export async function runEnqueueTransaction(
  client: TxClient,
  jobs: EnqueueRow[],
  broadcast_group_id: string
): Promise<number[]> {
  const ids: number[] = [];
  try {
    await client.query('BEGIN');
    for (const j of jobs) {
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
    // Roll back so NO partial subset of the broadcast survives. The caller rethrows;
    // because nothing committed, a user retry re-enqueues the FULL broadcast exactly
    // once (no double-spend on the already-inserted rows).
    await client.query('ROLLBACK');
    throw err;
  }
  return ids;
}
