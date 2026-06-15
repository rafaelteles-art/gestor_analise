import { describe, it, expect, afterEach, vi } from 'vitest';
import { expandBatch, createCampaignBatch, type BatchCreateInput } from '../meta-campaigns';
import { reduceCounts } from '../campaign-jobs-core';
import type { BatchRunState, BatchRunOpts, SeparationLevel } from '../batch-contract';

/**
 * F7 — separation-level grouping. Totals are ALWAYS N*C*S*A regardless of level;
 * only the grouping (and which entities are shared) changes. Cases use
 * N=3 creatives, C=1, S=2, A=1 (matches the ADR/plan examples).
 */
describe('expandBatch (separation grouping)', () => {
  const N = 3, C = 1, S = 2, A = 1;
  const TOTAL_ADS = N * C * S * A; // 6

  it("campaign level: N*C campaigns, each creative isolated (c:0:0, c:1:0, c:2:0)", () => {
    const { campaigns, adsets, ads } = expandBatch(N, C, S, A, 'campaign');
    expect(campaigns).toHaveLength(N * C); // 3
    expect(campaigns.map((c) => c.key)).toEqual(['c:0:0', 'c:1:0', 'c:2:0']);
    expect(campaigns.every((c) => c.creativeIdx !== null)).toBe(true);
    expect(adsets).toHaveLength(N * C * S); // 6
    expect(ads).toHaveLength(TOTAL_ADS); // 6
    // each campaign has exactly S adsets
    for (const c of campaigns) {
      expect(adsets.filter((s) => s.campKey === c.key)).toHaveLength(S);
    }
    // sample adset/ad key shapes
    expect(adsets.map((s) => s.key)).toContain('s:0:0:0');
    expect(ads.map((x) => x.key)).toContain('a:2:0:1:0');
  });

  it("adset level: C shared campaign (c:-:0) with N*S adsets", () => {
    const { campaigns, adsets, ads } = expandBatch(N, C, S, A, 'adset');
    expect(campaigns).toHaveLength(C); // 1
    expect(campaigns[0].key).toBe('c:-:0');
    expect(campaigns[0].creativeIdx).toBeNull();
    expect(adsets).toHaveLength(N * C * S); // 6
    // all adsets hang off the shared campaign
    expect(adsets.every((s) => s.campKey === 'c:-:0')).toBe(true);
    // each creative gets its own S adsets, keyed s:<cr>:<ci>:<si>
    expect(adsets.map((s) => s.key).sort()).toEqual(
      ['s:0:0:0', 's:0:0:1', 's:1:0:0', 's:1:0:1', 's:2:0:0', 's:2:0:1'].sort()
    );
    // _CJ suffix numbering is continuous within the shared campaign (1..6)
    expect(adsets.map((s) => s.setSuffixNum).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(ads).toHaveLength(TOTAL_ADS); // 6
  });

  it("ad level: C campaign, S shared adsets (s:-:0:0, s:-:0:1), N ads each", () => {
    const { campaigns, adsets, ads } = expandBatch(N, C, S, A, 'ad');
    expect(campaigns).toHaveLength(C); // 1
    expect(campaigns[0].key).toBe('c:-:0');
    expect(adsets).toHaveLength(C * S); // 2
    expect(adsets.map((s) => s.key)).toEqual(['s:-:0:0', 's:-:0:1']);
    expect(adsets.every((s) => s.creativeIdx === null)).toBe(true);
    expect(ads).toHaveLength(TOTAL_ADS); // 6
    // each shared adset holds N*A = 3 ads, one per creative
    for (const s of adsets) {
      const inAdset = ads.filter((x) => x.adsetKey === s.key);
      expect(inAdset).toHaveLength(N * A); // 3
      expect(inAdset.map((x) => x.creativeIdx).sort()).toEqual([0, 1, 2]);
      // _AD suffix numbering continuous within the adset (1..3)
      expect(inAdset.map((x) => x.adSuffixNum).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    }
    // ad key shape a:<cr>:<ci>:<si>:<ai>
    expect(ads.map((x) => x.key)).toContain('a:2:0:1:0');
  });

  it('totals are always N*C*S*A across all three levels', () => {
    const levels: SeparationLevel[] = ['campaign', 'adset', 'ad'];
    for (const level of levels) {
      const { ads } = expandBatch(N, C, S, A, level);
      expect(ads).toHaveLength(TOTAL_ADS);
    }
  });

  it('clamps zero/negative counters to 1 (defensive)', () => {
    const { campaigns, adsets, ads } = expandBatch(0, 0, 0, 0, 'campaign');
    expect(campaigns).toHaveLength(1);
    expect(adsets).toHaveLength(1);
    expect(ads).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createCampaignBatch — quality-review findings (orphan-AdCreative leak + page
// auto-retry on permanent creative errors). Drives the REAL orchestrator with a
// routed global.fetch mock so we exercise graphMutationWithRetry + the page loop.
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal Graph error body Meta would return (drives MetaApiError + subcode). */
function metaError(code: number, subcode?: number, message = 'erro') {
  return {
    ok: false,
    status: 400,
    statusText: 'Bad Request',
    headers: { get: () => null },
    json: async () => ({
      error: {
        code,
        ...(subcode !== undefined ? { error_subcode: subcode } : {}),
        message,
      },
    }),
  } as unknown as Response;
}

function metaOk(id: string) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    json: async () => ({ id }),
  } as unknown as Response;
}

function makeInput(over: Partial<BatchCreateInput> = {}): BatchCreateInput {
  return {
    account_id: 'act_test',
    access_token: 'tok',
    campaigns_per_creative: 1,
    adsets_per_campaign: 1,
    ads_per_adset: 1,
    page_ids: ['pageA', 'pageB', 'pageC'],
    page_auto_retry: true,
    campaign: {
      name: 'Camp',
      objective: 'OUTCOME_SALES',
      status: 'PAUSED',
      special_ad_categories: ['NONE'],
    },
    adset: {
      name: 'Set',
      optimization_goal: 'OFFSITE_CONVERSIONS',
      billing_event: 'IMPRESSIONS',
      promoted_object: { pixel_id: 'px', custom_event_type: 'PURCHASE' },
      targeting: { geo_locations: { countries: ['BR'] } },
      status: 'PAUSED',
    },
    // instagram_user_id set → createAdCreative skips the PBIA resolver (no extra fetch).
    creatives: [
      {
        name: 'Criativo 1',
        creative: {
          name: 'Criativo 1',
          page_id: 'pageA',
          instagram_user_id: 'ig_1',
          type: 'single',
          link: 'https://x.test',
          image_hash: 'hash123', // single creative requires link + image_hash
          message: 'oi',
        },
      },
    ],
    ...over,
  };
}

/** A fetch mock that routes by Graph path, with per-path response factories. */
function routedFetch(
  routes: {
    campaigns?: () => Response;
    adsets?: () => Response;
    adcreatives?: () => Response;
    ads?: () => Response;
  },
  calls: Record<string, number>
) {
  return vi.fn(async (url: URL | RequestInfo): Promise<Response> => {
    const u = String(url);
    if (u.includes('/adcreatives')) {
      calls.adcreatives = (calls.adcreatives ?? 0) + 1;
      return (routes.adcreatives ?? (() => metaOk('cr_default')))();
    }
    if (u.includes('/adsets')) {
      calls.adsets = (calls.adsets ?? 0) + 1;
      return (routes.adsets ?? (() => metaOk('set_default')))();
    }
    if (u.includes('/campaigns')) {
      calls.campaigns = (calls.campaigns ?? 0) + 1;
      return (routes.campaigns ?? (() => metaOk('camp_default')))();
    }
    if (u.endsWith('/ads')) {
      calls.ads = (calls.ads ?? 0) + 1;
      return (routes.ads ?? (() => metaOk('ad_default')))();
    }
    throw new Error(`unexpected fetch to ${u}`);
  });
}

const noopOpts = (runState: BatchRunState): BatchRunOpts => ({
  onEvent: async () => {},
  runState,
  shouldAbort: () => false,
});

describe('createCampaignBatch — orphan-AdCreative leak on resume', () => {
  const origFetch = global.fetch;
  afterEach(() => {
    global.fetch = origFetch;
    vi.restoreAllMocks();
  });

  it('checkpoints the AdCreative and REUSES it on resume instead of re-creating', async () => {
    const calls: Record<string, number> = {};
    const runState: BatchRunState = { created: {}, failed: {} };

    // RUN 1: campaign+adset+creative all succeed, but createAd fails permanently
    // (a non-transient code → no backoff, fails immediately). The ad branch is
    // recorded as failed; the creative must be checkpointed under its m:cr key.
    global.fetch = routedFetch(
      {
        ads: () => metaError(100, 1500, 'invalid adset link'), // permanent, non-page
      },
      calls
    );
    await createCampaignBatch(makeInput(), noopOpts(runState));

    expect(calls.adcreatives).toBe(1); // creative created exactly once in run 1
    // The creative id is checkpointed under an m:-prefixed key (excluded from counts).
    const creativeKeys = Object.keys(runState.created).filter((k) => k.startsWith('m:cr:'));
    expect(creativeKeys).toHaveLength(1);
    // The ad branch failed; its own key is NOT in created.
    expect(Object.keys(runState.failed).some((k) => k.startsWith('a:'))).toBe(true);

    // Capture the failed ad key recorded in run 1 — it must be CLEARED on the
    // successful resume below (otherwise it lingers in both created and failed).
    const failedAdKey = Object.keys(runState.failed).find((k) => k.startsWith('a:'));
    expect(failedAdKey).toBeDefined();

    // RUN 2 (resume): same runState. Now createAd succeeds. The creative MUST be
    // reused from the checkpoint — createAdCreative must NOT be called again.
    const calls2: Record<string, number> = {};
    global.fetch = routedFetch({}, calls2); // all OK by default
    const r2 = await createCampaignBatch(makeInput(), noopOpts(runState));

    expect(calls2.adcreatives ?? 0).toBe(0); // ← no duplicate orphan creative
    expect(calls2.ads).toBe(1); // ad finally created

    // The VALUE the worker writes back as authoritative (campaign-jobs.ts persists
    // result.counts and derives status from result.counts.failed). On this resume
    // the campaign+adset were created in run 1 and SKIPPED here, so the per-run
    // accumulator would say created=1 — but BatchRunResult.counts must be the
    // CUMULATIVE 3 with ZERO failed (the run-1 phantom failure was cleared). This
    // asserts the contract on the PRODUCTION path, not only via reduceCounts below.
    expect(r2.aborted).toBe(false);
    expect(r2.counts.created).toBe(3); // campaign + adset + ad, cumulative
    expect(r2.counts.failed).toBe(0); // phantom failed key is gone → status 'done'

    // ── Idempotency contract: a branch that FAILED in run 1 but SUCCEEDED on
    // resume must be removed from runState.failed (no stale failed-key leak).
    // The same key must NOT end up in BOTH created and failed.
    expect(runState.failed[failedAdKey!]).toBeUndefined();
    expect(Object.keys(runState.failed).some((k) => k.startsWith('a:'))).toBe(false);
    expect(runState.created[failedAdKey!]).toBeDefined(); // now lives only in created

    // ── reduceCounts must not double-count: 3 entities (campaign+adset+ad) all
    // created, ZERO failed (the phantom failure is gone), total = 3. Before the
    // fix this reported {created:3, failed:1, total:4} for this 3-entity batch.
    const counts = reduceCounts(runState, { created: 0, failed: 0, skipped: 0, total: 0 });
    expect(counts.failed).toBe(0);
    expect(counts.created).toBe(3); // c:0:0 + s:0:0:0 + a:0:0:0:0
    expect(counts.total).toBe(3); // no inflation from a phantom failed key
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createCampaignBatch — BatchRunResult.counts must be CUMULATIVE across a
// budget-abort resume (review finding A2). This drives the production path: the
// worker (campaign-jobs.ts) writes result.counts back as the authoritative final
// count and derives done/done_with_errors from result.counts.failed. The earlier
// orphan-resume test only asserted via reduceCounts(runState,...), so a per-run
// under-count of result.counts.created on resume slipped through. Here we assert
// on the RETURNED counts directly — the exact value the worker persists and shows
// the user — AND cross-check it agrees with reduceCounts (the map-based source).
// ─────────────────────────────────────────────────────────────────────────────
describe('createCampaignBatch — result.counts cumulative across budget-abort resume', () => {
  const origFetch = global.fetch;
  afterEach(() => {
    global.fetch = origFetch;
    vi.restoreAllMocks();
  });

  it('does NOT under-count created on resume: 3-entity batch returns counts.created=3, not 1', async () => {
    const runState: BatchRunState = { created: {}, failed: {} };

    // Single 1×1×1×1 batch → exactly 3 tracked entities: campaign (c:0:0),
    // adset (s:0:0:0), ad (a:0:0:0:0). All Graph calls succeed; the ONLY thing we
    // vary is shouldAbort, to force a budget-abort BETWEEN the adset and the ad.
    global.fetch = routedFetch(
      {
        campaigns: () => metaOk('camp_1'),
        adsets: () => metaOk('set_1'),
        adcreatives: () => metaOk('cr_1'),
        ads: () => metaOk('ad_1'),
      },
      {}
    );

    // ── TICK 1: shouldAbort() is checked at the top of each entity loop. Let the
    // campaign and the adset through (false, false), then abort right before the
    // ad (true). The orchestrator returns { aborted:true, counts } with the ad
    // still uncreated — counts MUST already reflect the 2 entities created so far.
    let abortCalls = 0;
    const tick1Opts: BatchRunOpts = {
      onEvent: async () => {},
      runState,
      shouldAbort: () => {
        abortCalls += 1;
        // calls 1 (campaign) and 2 (adset) → proceed; call 3 (ad) → abort.
        return abortCalls >= 3;
      },
    };
    const r1 = await createCampaignBatch(makeInput(), tick1Opts);

    expect(r1.aborted).toBe(true);
    expect(r1.counts.created).toBe(2); // campaign + adset created this tick
    // run_state durably holds both so the resume can skip them.
    expect(runState.created['c:0:0']).toBe('camp_1');
    expect(runState.created['s:0:0:0']).toBe('set_1');
    expect(runState.created['a:0:0:0:0']).toBeUndefined(); // ad not yet created

    // ── TICK 2 (resume): same runState, no abort. The campaign and adset are
    // already in runState.created so they are SKIPPED (no counts.created++ for
    // them this run). Only the ad is created. The per-run accumulator would say
    // created=1 — but BatchRunResult.counts must report the CUMULATIVE 3, because
    // that is the value the worker persists as final and the user sees.
    const r2 = await createCampaignBatch(makeInput(), noopOpts(runState));

    expect(r2.aborted).toBe(false);
    expect(runState.created['a:0:0:0:0']).toBe('ad_1'); // ad now created
    // THE REGRESSION GUARD: the returned final count is cumulative (3), NOT the
    // per-run 1. Before the fix this was 1 → the user saw "1 created" for a
    // 3-entity batch after any resume, compared against a cumulative total.
    expect(r2.counts.created).toBe(3); // campaign + adset + ad
    expect(r2.counts.failed).toBe(0);

    // The status decision in processJob uses result.counts.failed — must be 0 so
    // a fully-successful resumed batch is 'done', never 'done_with_errors'.
    expect(r2.counts.failed).toBe(0);

    // Cross-check: the returned counts agree with the map-based reduceCounts source
    // (the orphan test's assertion path). Production path and test path now match.
    const viaReduce = reduceCounts(runState, { created: 0, failed: 0, skipped: 0, total: 0 });
    expect(r2.counts.created).toBe(viaReduce.created); // 3 === 3
    expect(r2.counts.failed).toBe(viaReduce.failed); // 0 === 0
  });
});

describe('createCampaignBatch — page_auto_retry error classification', () => {
  const origFetch = global.fetch;
  afterEach(() => {
    global.fetch = origFetch;
    vi.restoreAllMocks();
  });

  it('does NOT advance pages on a permanent creative-level error (1 createAdCreative call)', async () => {
    const calls: Record<string, number> = {};
    const runState: BatchRunState = { created: {}, failed: {} };
    // Permanent, creative-level error (bad image_hash style) — NOT in the page/
    // identity allowlist and not transient. Must fail immediately, not retry the
    // SAME creative against pageB and pageC.
    global.fetch = routedFetch(
      { adcreatives: () => metaError(100, 1487291, 'invalid creative spec') },
      calls
    );
    await createCampaignBatch(makeInput(), noopOpts(runState));

    expect(calls.adcreatives).toBe(1); // exactly one attempt — no page fan-out
    expect(Object.keys(runState.failed).some((k) => k.startsWith('a:'))).toBe(true);
  });

  it('DOES advance pages on a page/identity error (#100/1772103 IG-missing)', async () => {
    const calls: Record<string, number> = {};
    const runState: BatchRunState = { created: {}, failed: {} };
    // First two pages fail with the page/identity subcode (1772103); third succeeds.
    let n = 0;
    global.fetch = routedFetch(
      {
        adcreatives: () => {
          n += 1;
          return n < 3 ? metaError(100, 1772103, 'IG account missing') : metaOk('cr_ok');
        },
      },
      calls
    );
    await createCampaignBatch(makeInput(), noopOpts(runState));

    expect(calls.adcreatives).toBe(3); // advanced pageA→pageB→pageC
    expect(calls.ads).toBe(1); // ad created after the working page
  });
});
