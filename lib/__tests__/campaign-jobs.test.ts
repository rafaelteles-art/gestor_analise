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
  isTransientMediaError,
  normalizeBatchInput,
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

describe('isTransientMediaError — media upload retry/resume classifier', () => {
  // Shape of a MetaApiError thrown by uploadImage/uploadVideo (lib/meta-campaigns.ts):
  // { name:'MetaApiError', fbCode?:number, httpStatus?:number, message:string }.
  function metaErr(p: { fbCode?: number; httpStatus?: number }): unknown {
    return { name: 'MetaApiError', message: 'boom', ...p };
  }

  it('treats Meta throttle codes (4 app, 17 user, 80004 ad-account) as transient', () => {
    expect(isTransientMediaError(metaErr({ fbCode: 4 }))).toBe(true);
    expect(isTransientMediaError(metaErr({ fbCode: 17 }))).toBe(true);
    expect(isTransientMediaError(metaErr({ fbCode: 80004 }))).toBe(true);
  });

  it('treats temporary codes (1, 2, 341, 368) as transient', () => {
    for (const fbCode of [1, 2, 341, 368]) {
      expect(isTransientMediaError(metaErr({ fbCode }))).toBe(true);
    }
  });

  it('treats HTTP 429 and 5xx as transient', () => {
    expect(isTransientMediaError(metaErr({ httpStatus: 429 }))).toBe(true);
    expect(isTransientMediaError(metaErr({ httpStatus: 500 }))).toBe(true);
    expect(isTransientMediaError(metaErr({ httpStatus: 503 }))).toBe(true);
  });

  it('treats a PERMANENT Meta error (bad spec / invalid hash, e.g. code 100, HTTP 400) as NOT transient', () => {
    expect(isTransientMediaError(metaErr({ fbCode: 100, httpStatus: 400 }))).toBe(false);
    // A MetaApiError with no transient signal must terminate, not loop forever.
    expect(isTransientMediaError(metaErr({}))).toBe(false);
  });

  it('treats bare network-layer failures (fetch TypeError, ECONNRESET, AbortError) as transient', () => {
    expect(isTransientMediaError(new TypeError('fetch failed'))).toBe(true);
    expect(isTransientMediaError({ name: 'Error', code: 'ECONNRESET', message: 'reset' })).toBe(true);
    expect(isTransientMediaError({ name: 'AbortError', message: 'aborted' })).toBe(true);
    expect(isTransientMediaError({ name: 'Error', code: 'ETIMEDOUT' })).toBe(true);
  });

  it('treats a plain non-network Error as NOT transient (fail fast)', () => {
    expect(isTransientMediaError(new Error('Resposta sem hash'))).toBe(false);
    expect(isTransientMediaError(null)).toBe(false);
    expect(isTransientMediaError(undefined)).toBe(false);
    expect(isTransientMediaError('string error')).toBe(false);
  });
});

describe('normalizeBatchInput — payload→BatchCreateInput unwrap (review fix #2)', () => {
  it('flattens a NESTED batch payload to the top level runBatch destructures', () => {
    // Mirrors create/route.ts basePayload for a BATCH request: nested batch{},
    // worker-injected account_id/access_token/frozen_context/separation_level.
    const payload = {
      account_id: 'act_999',
      access_token: 'TOK',
      profile_name: 'P1',
      separation_level: 'adset',
      frozen_context: { ano: '2026', mes: '06' },
      batch: {
        campaign: { name: 'C' },
        adset: { name: 'S' },
        creatives: [{ name: 'cr0', creative: {} }],
        campaigns_per_creative: 2,
        adsets_per_campaign: 1,
        ads_per_adset: 1,
        page_ids: ['pg1'],
      },
    };
    const out = normalizeBatchInput(payload);
    // The fields createCampaignBatch destructures must now be TOP-LEVEL.
    expect(out.campaign).toEqual({ name: 'C' });
    expect(out.adset).toEqual({ name: 'S' });
    expect(out.creatives).toEqual([{ name: 'cr0', creative: {} }]);
    expect(out.campaigns_per_creative).toBe(2);
    expect(out.adsets_per_campaign).toBe(1);
    expect(out.ads_per_adset).toBe(1);
    expect(out.page_ids).toEqual(['pg1']);
    // Worker-injected fields survive.
    expect(out.account_id).toBe('act_999');
    expect(out.access_token).toBe('TOK');
    expect(out.frozen_context).toEqual({ ano: '2026', mes: '06' });
    expect(out.separation_level).toBe('adset');
    // The nested `batch` key is dropped after flattening.
    expect(out.batch).toBeUndefined();
  });

  it('keeps worker-injected fields authoritative over stale duplicates inside batch', () => {
    // If a stale token/account leaked INTO batch (e.g. from a re-enqueued history
    // payload), the frozen worker-injected top-level values must still win.
    const payload = {
      account_id: 'act_top',
      access_token: 'TOK_top',
      separation_level: 'campaign',
      batch: {
        account_id: 'act_stale',
        access_token: 'TOK_stale',
        campaign: { name: 'C' },
        adset: { name: 'S' },
        creatives: [{ name: 'cr0', creative: {} }],
        campaigns_per_creative: 1,
      },
    };
    const out = normalizeBatchInput(payload);
    expect(out.account_id).toBe('act_top');
    expect(out.access_token).toBe('TOK_top');
  });

  it('falls back to a separation_level nested in batch when the top level lacks one', () => {
    const payload = {
      account_id: 'act_1',
      access_token: 'TOK',
      // no top-level separation_level
      batch: {
        separation_level: 'ad',
        campaign: { name: 'C' },
        adset: { name: 'S' },
        creatives: [{ name: 'cr0', creative: {} }],
        campaigns_per_creative: 1,
      },
    };
    expect(normalizeBatchInput(payload).separation_level).toBe('ad');
  });

  it('passes a legacy/already-flat payload through unchanged (no batch key)', () => {
    const payload = {
      account_id: 'act_1',
      access_token: 'TOK',
      campaign: { name: 'C' },
      adset: { name: 'S' },
      ads: [{ name: 'a0' }],
      campaigns_per_creative: 1,
    };
    const out = normalizeBatchInput(payload);
    expect(out.campaign).toEqual({ name: 'C' });
    expect(out.adset).toEqual({ name: 'S' });
    expect(out.ads).toEqual([{ name: 'a0' }]);
    expect(out.batch).toBeUndefined();
  });

  it('is null/undefined-safe (returns an object, never throws)', () => {
    expect(normalizeBatchInput(undefined)).toEqual({});
    expect(normalizeBatchInput(null)).toEqual({});
    // A non-object batch value is ignored (treated as flat).
    expect(normalizeBatchInput({ batch: 'oops', account_id: 'a' })).toEqual({
      batch: 'oops',
      account_id: 'a',
    });
  });
});

describe('worker tick — transient pause must YIELD, not busy-retry (review fix #1)', () => {
  // The busy-retry loop lives in runQueueTick/processJob inside lib/campaign-jobs.ts,
  // which pulls in meta-campaigns.ts (whose `@/` aliases vitest can't resolve), so
  // we can't import and drive the loop here. We assert the structural guarantees on
  // the source text instead — a REGRESSION GUARD: if someone collapses the transient
  // pause back into the budget pause (the original bug), these fail.
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'campaign-jobs.ts'),
    'utf8'
  );

  it('distinguishes a transient media pause from a budget pause', () => {
    // A transient throttle yields a distinct outcome, not the same 'budget' the
    // time-budget abort uses.
    expect(src).toContain("kind: 'paused-transient'");
    expect(src).toContain("kind: 'paused-budget'");
  });

  it('processJob returns a distinct yield outcome for the transient pause', () => {
    expect(src).toContain("media.kind === 'paused-transient'");
    expect(src).toContain("return 'yield'");
  });

  it('runQueueTick BREAKS the drain loop on yield so a later tick provides backoff', () => {
    // The exact line that stops the tick from immediately re-claiming the just-
    // released job and tight-looping on the throttled Meta endpoint.
    expect(src).toContain("if (outcome === 'yield') break;");
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

describe('requestCancel SQL — already-cancelled job must NOT return a false-success', () => {
  // requestCancel() cannot be unit-tested against the DB here (no pool in vitest),
  // but the correctness guarantee lives in the SQL shape. We assert the structural
  // properties as a REGRESSION GUARD: if someone reverts the CTE-based fix back to
  // the plain UPDATE…RETURNING form (where both "just cancelled" and "already
  // cancelled" look identical), these tests fail.
  //
  // The bug: the original UPDATE returned `status='cancelled'` for BOTH cases, so
  // the function returned 'cancelled' for a double-cancel. The CTE captures
  // old_status BEFORE the mutation, so we can return 'not_cancellable' for the
  // second call.
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'campaign-jobs.ts'),
    'utf8'
  );

  it('uses a CTE to capture old_status before the UPDATE', () => {
    // The CTE name 'prev' is how we read the pre-mutation status.
    expect(src).toContain('WITH prev AS (');
    expect(src).toContain('old_status');
  });

  it('locks the cancel target row inside the CTE to serialize concurrent calls', () => {
    // FOR UPDATE inside the CTE ensures two concurrent double-clicks serialize: the
    // second call sees old_status='cancelled' (already flipped) and returns
    // 'not_cancellable' instead of a false-success 'cancelled'.
    expect(src).toContain('FOR UPDATE');
  });

  it('classifies the outcome based on old_status, not the post-update status', () => {
    // The only way to return 'cancelled' is when old_status was 'pending'. A job
    // that was ALREADY cancelled will have old_status='cancelled' and must fall
    // through to 'not_cancellable'.
    expect(src).toContain("row.old_status === 'pending'");
    expect(src).not.toMatch(/row\.status\s*===\s*'cancelled'/);
  });
});
