import { describe, it, expect } from 'vitest';
// Import from the dependency-free core module (not ../campaign-jobs, which pulls
// in lib/meta-campaigns.ts whose `@/` aliases vitest can't resolve). The main
// module re-exports these same functions AND calls these exact builders, so
// asserting against the builder output / pure classifiers here gives BEHAVIORAL
// coverage of the real query text and decision logic — not a readFileSync string
// match over the source file (review fix #3).
import {
  pickRunnableJobId,
  reduceCounts,
  clampListLimit,
  isTransientMediaError,
  normalizeBatchInput,
  buildClaimSql,
  buildCancelSql,
  classifyCancelOutcome,
  shouldContinueDraining,
  decodeVidCheckpoint,
  runEnqueueTransaction,
  type RunnableJobView,
  type JobCounts,
  type TxClient,
  type EnqueueRow,
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

  it('at the EXACT lease boundary (leased_until == now) a running job IS runnable', () => {
    // Review fix #2: the model must mirror the SQL's single-now() semantics at the
    // tick boundary. With `<= now()` in both the model and buildClaimSql's resume
    // branch, a lease that expires at precisely now() is resumable (NOT a momentary
    // limbo where the row is neither blocker nor runnable, which strict `<` produced).
    const jobs = [
      job({ id: 9, profile_name: 'P1', status: 'running', leased_until: NOW }),
    ];
    expect(pickRunnableJobId(jobs, NOW)).toBe(9);
  });

  it('a running job whose lease == now does NOT block a same-profile pending job', () => {
    // The other half of the boundary: at leased_until == now the live-run blocker
    // (strict `>` in both model and SQL) is false, so a sibling pending job is also
    // runnable. FIFO → the lower id (the just-expired running row) wins.
    const jobs = [
      job({ id: 4, profile_name: 'P1', status: 'running', leased_until: NOW }),
      job({ id: 7, profile_name: 'P1', status: 'pending' }),
    ];
    expect(pickRunnableJobId(jobs, NOW)).toBe(4);
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

describe('shouldContinueDraining — worker tick yield-vs-continue (review fix #1)', () => {
  // BEHAVIORAL coverage (not a source-text grep): runQueueTick calls this exact pure
  // function to decide whether to keep draining. A transient throttle ('yield') MUST
  // stop the loop so a later cron tick backs off instead of busy-retrying the
  // throttled Meta endpoint by immediately re-claiming the just-released job; a
  // 'finished'/'budget' outcome keeps draining other profiles' work this tick.
  it('STOPS draining on a transient yield (the backoff guarantee)', () => {
    expect(shouldContinueDraining('yield')).toBe(false);
  });

  it('keeps draining after a job finishes', () => {
    expect(shouldContinueDraining('finished')).toBe(true);
  });

  it('keeps draining after a budget pause (other profiles may still have work)', () => {
    expect(shouldContinueDraining('budget')).toBe(true);
  });
});

describe('buildClaimSql — race-safe per-Profile claim statement (review fix #3)', () => {
  // BEHAVIORAL: assert against the ACTUAL SQL string claimNextCampaignJob runs
  // (claimNextCampaignJob calls buildClaimSql()), not a readFileSync of the source
  // file. The two-transaction race (two ticks each claim a different pending job for
  // the same profile) can't be exercised without a live Postgres, but the query that
  // prevents it is exactly this string — so verifying its structure here ties the
  // guarantee to the real query and survives cosmetic refactors of campaign-jobs.ts.
  const sql = buildClaimSql();

  it('acquires a profile-keyed advisory lock as the mutual-exclusion primitive', () => {
    // Without this lock two concurrent ticks could each claim a different pending job
    // for the same profile → two batches on one Meta token, defeating ADR-0005.
    expect(sql).toContain('pg_try_advisory_xact_lock(hashtext(j.profile_name))');
  });

  it('uses FOR UPDATE SKIP LOCKED so concurrent ticks never grab the same row', () => {
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
  });

  it('blocks a pending job behind a same-profile live run via NOT EXISTS', () => {
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toMatch(/r\.status\s*=\s*'running'/);
    expect(sql).toContain('r.leased_until > now()'); // strict: live run blocks
  });

  it('treats an expired-or-exactly-now running lease as resumable (<= now boundary)', () => {
    // Mirrors pickRunnableJobId's `<=` so the unit model is faithful at the tick
    // boundary (review fix #2). A strict `<` here would diverge from the model.
    expect(sql).toContain('j.leased_until <= now()');
    expect(sql).not.toContain('j.leased_until < now()'); // the old, divergent operator
  });

  it('claims FIFO by id and flips the row to running with a fresh lease', () => {
    expect(sql).toContain('ORDER BY j.id ASC');
    expect(sql).toMatch(/status\s*=\s*'running'/);
    expect(sql).toContain("leased_until = now() + ($1 || ' minutes')::interval");
    expect(sql).toContain('started_at = COALESCE(started_at, now())');
  });
});

describe('classifyCancelOutcome — double-cancel must NOT false-succeed (review fix #3)', () => {
  // BEHAVIORAL: requestCancel runs buildCancelSql() then feeds the RETURNING row to
  // this exact pure classifier. We drive it with the rows the CTE produces in each
  // real scenario and assert the verdict — so the "already-cancelled returns 409, not
  // a false-success 200" guarantee is tested by EXECUTING the decision, not grepping.
  it('returns not_found when no row came back (id does not exist)', () => {
    expect(classifyCancelOutcome(undefined)).toBe('not_found');
  });

  it('returns cancelled when THIS call flipped pending→cancelled (old_status pending)', () => {
    // The CTE captured old_status BEFORE the update; pending means we just cancelled.
    expect(classifyCancelOutcome({ old_status: 'pending', cancel_requested: false })).toBe('cancelled');
  });

  it('returns cancel_requested for a running job we flagged for cooperative stop', () => {
    expect(classifyCancelOutcome({ old_status: 'running', cancel_requested: true })).toBe('cancel_requested');
  });

  it('returns not_cancellable (→ 409) for an ALREADY-cancelled job — the core bug', () => {
    // The second of two concurrent cancels: the CTE's FOR UPDATE serialized it, so it
    // sees old_status='cancelled' (already flipped by the first call) and
    // cancel_requested=false → must NOT report a false-success 'cancelled'.
    expect(classifyCancelOutcome({ old_status: 'cancelled', cancel_requested: false })).toBe('not_cancellable');
  });

  it('returns not_cancellable for terminal jobs (done / done_with_errors / error)', () => {
    for (const old_status of ['done', 'done_with_errors', 'error']) {
      expect(classifyCancelOutcome({ old_status, cancel_requested: false })).toBe('not_cancellable');
    }
  });
});

describe('buildCancelSql — CTE captures old_status before mutating (review fix #3)', () => {
  // BEHAVIORAL: this is the exact string requestCancel runs. The plain
  // UPDATE…RETURNING form could not tell "just cancelled" from "already cancelled"
  // (both show status='cancelled'); the CTE reads the pre-mutation status, locked
  // FOR UPDATE so concurrent double-clicks serialize.
  const sql = buildCancelSql();

  it('reads the pre-mutation status via a prev CTE locked FOR UPDATE', () => {
    expect(sql).toContain('WITH prev AS (');
    expect(sql).toMatch(/SELECT status FROM campaign_jobs WHERE id = \$1 FOR UPDATE/);
  });

  it('returns prev.status AS old_status so the classifier can distinguish the cases', () => {
    expect(sql).toContain('RETURNING prev.status AS old_status');
    expect(sql).toContain('campaign_jobs.cancel_requested');
  });

  it('only flips pending→cancelled, and only flags cancel_requested for a running job', () => {
    expect(sql).toMatch(/WHEN prev\.status = 'pending' THEN 'cancelled'/);
    expect(sql).toMatch(/WHEN prev\.status = 'running' THEN TRUE/);
  });
});

describe('runEnqueueTransaction — multi-account broadcast is all-or-nothing (review fix #3)', () => {
  // BEHAVIORAL: enqueueCampaignJobs delegates the BEGIN/INSERT×N/COMMIT to THIS exact
  // function with the leased pool client injected. We drive it with a fake client that
  // records the query sequence (and can be made to throw on the Kth insert) and assert
  // the atomicity contract by EXECUTION — not by readFileSync-ing the source. The bug
  // it guards: a partial commit on a mid-loop failure, which a user retry would then
  // double-enqueue → duplicate real campaigns (double-spend).

  // A fake pg client: records every (text, params) call; optional failAtInsert makes
  // the Nth INSERT (1-based) throw, simulating a DB blip mid-broadcast.
  function fakeClient(opts: { failAtInsert?: number } = {}) {
    const calls: string[] = [];
    let insertSeen = 0;
    let nextId = 100;
    const client: TxClient = {
      async query(text: string) {
        const head = text.trim().split(/\s+/).slice(0, 3).join(' ');
        if (/^INSERT INTO campaign_jobs/.test(text.trim())) {
          insertSeen++;
          if (opts.failAtInsert && insertSeen === opts.failAtInsert) {
            calls.push(`INSERT#${insertSeen}-THROW`);
            throw new Error('connection reset mid-broadcast');
          }
          calls.push(`INSERT#${insertSeen}`);
          return { rows: [{ id: nextId++ }] };
        }
        calls.push(head); // BEGIN / COMMIT / ROLLBACK
        return { rows: [] };
      },
    };
    return { client, calls: () => calls };
  }

  const rows: EnqueueRow[] = [
    { profile_name: 'P1', account_id: 'act_1', account_name: 'A', payload: { batch: {} } },
    { profile_name: 'P1', account_id: 'act_2', account_name: 'B', payload: { batch: {} } },
    { profile_name: 'P1', account_id: 'act_3', account_name: 'C', payload: { batch: {} } },
  ];

  it('commits all rows in one transaction and returns the ids in input order', async () => {
    const { client, calls } = fakeClient();
    const ids = await runEnqueueTransaction(client, rows, 'grp-1');
    expect(ids).toEqual([100, 101, 102]);
    // BEGIN → 3 INSERTs → COMMIT, exactly once, in order. No ROLLBACK.
    expect(calls()).toEqual(['BEGIN', 'INSERT#1', 'INSERT#2', 'INSERT#3', 'COMMIT']);
  });

  it('ROLLS BACK and rethrows when an insert fails mid-loop (no partial commit)', async () => {
    const { client, calls } = fakeClient({ failAtInsert: 2 });
    await expect(runEnqueueTransaction(client, rows, 'grp-1')).rejects.toThrow(
      'connection reset mid-broadcast'
    );
    // The 1st insert succeeded, the 2nd threw → ROLLBACK, and crucially NO COMMIT, so
    // the already-inserted row #1 never survives. A retry re-enqueues the FULL set.
    expect(calls()).toEqual(['BEGIN', 'INSERT#1', 'INSERT#2-THROW', 'ROLLBACK']);
    expect(calls()).not.toContain('COMMIT');
  });

  it('handles a single-account broadcast (one INSERT, still wrapped in a transaction)', async () => {
    const { client, calls } = fakeClient();
    const ids = await runEnqueueTransaction(client, [rows[0]], 'grp-1');
    expect(ids).toEqual([100]);
    expect(calls()).toEqual(['BEGIN', 'INSERT#1', 'COMMIT']);
  });
});

describe('decodeVidCheckpoint — split on the FIRST delimiter only (review fix #3)', () => {
  // BEHAVIORAL: applyMediaCheckpoint in campaign-jobs.ts calls THIS exact function to
  // decode `vid:${video_id}|${thumbnail_url}`, so we test the real production decode,
  // not a replica. The bug was `rest.split('|')` + `[video_id, thumb]`, which silently
  // DISCARDED anything after the first '|' — a Meta CDN signed thumbnail URL is not
  // guaranteed free of '|'. The fix splits on indexOf('|') so the thumbnail keeps
  // everything after the first delimiter.
  it('keeps a thumbnail URL that itself contains "|" intact (the regression)', () => {
    const out = decodeVidCheckpoint('vid:1789|https://cdn.example/t.jpg?sig=a|b|c');
    expect(out.video_id).toBe('1789');
    // The lossy split would have dropped "|b|c"; the fix preserves the whole tail.
    expect(out.thumbnail_url).toBe('https://cdn.example/t.jpg?sig=a|b|c');
  });

  it('decodes a plain video_id|thumbnail with no extra delimiters', () => {
    const out = decodeVidCheckpoint('vid:999|https://cdn/t.jpg');
    expect(out.video_id).toBe('999');
    expect(out.thumbnail_url).toBe('https://cdn/t.jpg');
  });

  it('handles a checkpoint with no thumbnail (delimiter absent → undefined)', () => {
    const out = decodeVidCheckpoint('vid:42');
    expect(out.video_id).toBe('42');
    expect(out.thumbnail_url).toBeUndefined();
  });
});
