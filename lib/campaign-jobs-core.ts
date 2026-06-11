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
 * entities). `skipped` is supplied separately (we accumulate it as events arrive,
 * since skips aren't stored in run_state). `total` is preserved from prior counts.
 */
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
  return { created, failed, skipped, total: prior.total };
}
