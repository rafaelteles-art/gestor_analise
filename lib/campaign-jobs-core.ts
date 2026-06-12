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
      return j.leased_until === null || j.leased_until < nowMs;
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
