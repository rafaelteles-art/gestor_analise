import { describe, it, expect } from 'vitest';
// Import from the dependency-free core module (not ../campaign-jobs, which pulls
// in lib/meta-campaigns.ts whose `@/` aliases vitest can't resolve). The main
// module re-exports these same functions.
import {
  pickRunnableJobId,
  reduceCounts,
  type RunnableJobView,
  type JobCounts,
} from '../campaign-jobs-core';
import type { BatchRunState, BatchEvent } from '../batch-contract';

const NOW = 1_000_000_000_000; // fixed epoch ms for deterministic lease math
const MIN = 60_000;

function job(p: Partial<RunnableJobView> & { id: number }): RunnableJobView {
  return {
    status: 'pending',
    profile_name: 'P1',
    leased_until: null,
    ...p,
  };
}

describe('pickRunnableJobId — per-Profile FIFO serialization', () => {
  it('claims the lowest-id pending job when nothing is running (FIFO order)', () => {
    const jobs = [
      job({ id: 30, profile_name: 'P1' }),
      job({ id: 10, profile_name: 'P1' }),
      job({ id: 20, profile_name: 'P1' }),
    ];
    expect(pickRunnableJobId(jobs, NOW)).toBe(10);
  });

  it('blocks a same-profile pending job while another P1 job runs with a live lease', () => {
    const jobs = [
      job({ id: 5, profile_name: 'P1', status: 'running', leased_until: NOW + 10 * MIN }),
      job({ id: 6, profile_name: 'P1', status: 'pending' }),
    ];
    // The only runnable candidate is the running one — but its lease is live, so
    // it is NOT runnable; and id 6 is blocked by the live P1 run → null.
    expect(pickRunnableJobId(jobs, NOW)).toBeNull();
  });

  it('does NOT block a different-profile pending job', () => {
    const jobs = [
      job({ id: 5, profile_name: 'P1', status: 'running', leased_until: NOW + 10 * MIN }),
      job({ id: 6, profile_name: 'P2', status: 'pending' }),
    ];
    expect(pickRunnableJobId(jobs, NOW)).toBe(6);
  });

  it('treats a running job with an EXPIRED lease as runnable (crash resume)', () => {
    const jobs = [
      job({ id: 7, profile_name: 'P1', status: 'running', leased_until: NOW - 1 }),
    ];
    expect(pickRunnableJobId(jobs, NOW)).toBe(7);
  });

  it('treats a running job with a NULL lease as runnable (crash before lease set)', () => {
    const jobs = [
      job({ id: 8, profile_name: 'P1', status: 'running', leased_until: null }),
    ];
    expect(pickRunnableJobId(jobs, NOW)).toBe(8);
  });

  it('an expired-lease running P1 job does NOT block another P1 pending job; lower id wins', () => {
    const jobs = [
      job({ id: 2, profile_name: 'P1', status: 'running', leased_until: NOW - 1 }),
      job({ id: 3, profile_name: 'P1', status: 'pending' }),
    ];
    // Both are runnable (expired running + pending unblocked). FIFO → id 2.
    expect(pickRunnableJobId(jobs, NOW)).toBe(2);
  });

  it('ignores terminal jobs entirely', () => {
    const jobs = [
      job({ id: 1, profile_name: 'P1', status: 'done', leased_until: null }),
      job({ id: 2, profile_name: 'P1', status: 'cancelled', leased_until: null }),
      job({ id: 3, profile_name: 'P1', status: 'error', leased_until: null }),
    ];
    expect(pickRunnableJobId(jobs, NOW)).toBeNull();
  });

  it('runs jobs of distinct profiles independently (each profile picked by FIFO)', () => {
    const jobs = [
      job({ id: 10, profile_name: 'A', status: 'pending' }),
      job({ id: 11, profile_name: 'B', status: 'running', leased_until: NOW + 5 * MIN }),
      job({ id: 12, profile_name: 'B', status: 'pending' }),
    ];
    // A has no live run → its pending id 10 is runnable; B is blocked by id 11.
    expect(pickRunnableJobId(jobs, NOW)).toBe(10);
  });

  it('returns null on an empty job list', () => {
    expect(pickRunnableJobId([], NOW)).toBeNull();
  });
});

describe('reduceCounts — event → counts reducer', () => {
  const base: JobCounts = { created: 0, failed: 0, skipped: 0, total: 6 };

  it('counts created entities from run_state, preserving total', () => {
    const rs: BatchRunState = {
      created: { 'c:0:0': '111', 's:0:0:0': '222' },
      failed: {},
    };
    const event: BatchEvent = { kind: 'created', key: 'c:0:0', entity: 'campaign', name: 'X', id: '111' };
    expect(reduceCounts(rs, base, event)).toEqual({ created: 2, failed: 0, skipped: 0, total: 6 });
  });

  it('counts failed entities from run_state', () => {
    const rs: BatchRunState = {
      created: { 'c:0:0': '111' },
      failed: { 's:0:0:0': 'boom' },
    };
    const event: BatchEvent = {
      kind: 'failed', key: 's:0:0:0', entity: 'adset', name: 'Y', error: 'boom', permanent: true,
    };
    expect(reduceCounts(rs, base, event)).toEqual({ created: 1, failed: 1, skipped: 0, total: 6 });
  });

  it('increments skipped only on a skipped event (run_state does not store skips)', () => {
    const rs: BatchRunState = { created: { 'c:0:0': '111' }, failed: { 'c:1:0': 'boom' } };
    const event: BatchEvent = { kind: 'skipped', key: 'a:1:0:0:0', reason: 'ancestor failed' };
    const out = reduceCounts(rs, { ...base, skipped: 2 }, event);
    expect(out).toEqual({ created: 1, failed: 1, skipped: 3, total: 6 });
  });

  it('excludes media-only m:<idx> checkpoint keys from created (they are not ad entities)', () => {
    const rs: BatchRunState = {
      created: { 'm:0': 'img:abc', 'm:1': 'vid:999|http://t', 'c:0:0': '111' },
      failed: {},
    };
    expect(reduceCounts(rs, base).created).toBe(1);
  });

  it('does not change skipped when no event or a non-skip event is given', () => {
    const rs: BatchRunState = { created: {}, failed: {} };
    expect(reduceCounts(rs, { ...base, skipped: 5 }).skipped).toBe(5);
    const created: BatchEvent = { kind: 'created', key: 'c:0:0', entity: 'campaign', name: 'X', id: '1' };
    expect(reduceCounts(rs, { ...base, skipped: 5 }, created).skipped).toBe(5);
  });
});
