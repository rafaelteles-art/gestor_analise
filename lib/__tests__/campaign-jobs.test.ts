import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// Import from the dependency-free core module (not ../campaign-jobs, which pulls
// in lib/meta-campaigns.ts whose `@/` aliases vitest can't resolve). The main
// module re-exports these same functions.
import {
  pickRunnableJobId,
  reduceCounts,
  clampListLimit,
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

  it('derives total from observed entities when prior.total is 0 (no permanent /0)', () => {
    // Reproduces the enqueue seed (total: 0). After entities flow through,
    // total must reflect created+failed+skipped, never stay 0.
    const zero: JobCounts = { created: 0, failed: 0, skipped: 0, total: 0 };
    const rs: BatchRunState = {
      created: { 'c:0:0': '111', 's:0:0:0': '222' },
      failed: { 'a:0:0:0:0': 'boom' },
    };
    const event: BatchEvent = { kind: 'created', key: 's:0:0:0', entity: 'adset', name: 'Y', id: '222' };
    // created 2 + failed 1 + skipped 0 = 3 (media m: keys excluded)
    expect(reduceCounts(rs, zero, event)).toEqual({ created: 2, failed: 1, skipped: 0, total: 3 });
  });

  it('counts a skipped event into the derived total', () => {
    const zero: JobCounts = { created: 0, failed: 0, skipped: 0, total: 0 };
    const rs: BatchRunState = { created: { 'c:0:0': '111' }, failed: {} };
    const event: BatchEvent = { kind: 'skipped', key: 'a:1:0:0:0', reason: 'ancestor failed' };
    // created 1 + failed 0 + skipped 1 = 2
    expect(reduceCounts(rs, zero, event)).toEqual({ created: 1, failed: 0, skipped: 1, total: 2 });
  });

  it('never regresses total below the denominator the user already saw', () => {
    // A resumed run resets skipped to 0 (processJob does this); total must not
    // shrink even though created+failed+skipped of the current run is smaller.
    const prior: JobCounts = { created: 1, failed: 0, skipped: 0, total: 10 };
    const rs: BatchRunState = { created: { 'c:0:0': '111' }, failed: {} };
    expect(reduceCounts(rs, prior).total).toBe(10);
  });

  it('media-only m: checkpoint keys do not inflate the derived total', () => {
    const zero: JobCounts = { created: 0, failed: 0, skipped: 0, total: 0 };
    const rs: BatchRunState = {
      created: { 'm:0': 'img:abc', 'm:1': 'vid:999', 'c:0:0': '111' },
      failed: {},
    };
    // only c:0:0 counts → created 1, total 1
    const out = reduceCounts(rs, zero);
    expect(out.created).toBe(1);
    expect(out.total).toBe(1);
  });
});

describe('clampListLimit — list page-size clamp (NaN-safe)', () => {
  it('defaults to 50 when no limit is given', () => {
    expect(clampListLimit(undefined)).toBe(50);
  });

  it('falls back to the default (not NaN) when limit is NaN', () => {
    // Repro of the bug: ?limit=abc → Number('abc') = NaN. `?? 50` does NOT catch
    // NaN, so without the Number.isFinite gate this would produce NaN and bind a
    // NaN LIMIT that Postgres rejects → 500 on a malformed query string.
    expect(clampListLimit(NaN)).toBe(50);
    expect(Number.isNaN(clampListLimit(NaN))).toBe(false);
  });

  it('passes a valid in-range limit through unchanged', () => {
    expect(clampListLimit(25)).toBe(25);
  });

  it('clamps below 1 up to 1', () => {
    expect(clampListLimit(0)).toBe(1);
    expect(clampListLimit(-5)).toBe(1);
  });

  it('clamps above the max (200) down to 200', () => {
    expect(clampListLimit(10_000)).toBe(200);
  });

  it('floors a non-integer so the bound is always a clean integer for LIMIT $n', () => {
    expect(clampListLimit(12.9)).toBe(12);
  });

  it('treats Infinity as non-finite and falls back to the default', () => {
    expect(clampListLimit(Infinity)).toBe(50);
    expect(clampListLimit(-Infinity)).toBe(50);
  });
});

describe('claim SQL — race-safe per-Profile serialization guard', () => {
  // The two-transaction race cannot be exercised against the pure
  // pickRunnableJobId model (it sees a single static snapshot, never two
  // concurrent claims). The real guarantee lives in the SQL claim, so we assert
  // here that the profile-keyed advisory lock is present in the claim statement.
  // This is a REGRESSION GUARD: if someone deletes the lock (reintroducing the
  // bug where two ticks each claim a different pending job for the same profile),
  // this test fails. We read the source as text rather than importing the module,
  // because lib/campaign-jobs.ts pulls in meta-campaigns.ts (whose `@/` aliases
  // vitest can't resolve).
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'campaign-jobs.ts'),
    'utf8'
  );

  it('locks the claim per profile_name with pg_try_advisory_xact_lock', () => {
    expect(src).toContain('pg_try_advisory_xact_lock(hashtext(j.profile_name))');
  });

  it('still uses FOR UPDATE SKIP LOCKED so concurrent ticks never grab the same row', () => {
    expect(src).toContain('FOR UPDATE SKIP LOCKED');
  });

  it('keeps the NOT EXISTS live-run guard for the common case', () => {
    expect(src).toContain('NOT EXISTS');
  });
});
