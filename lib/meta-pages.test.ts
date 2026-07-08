import { describe, it, expect } from 'vitest';
import {
  tokensForAccount, selectProfiles, foldAdsVolumeRows,
  orderProfilesBySize, applyPersistedOrder, runProfileSyncChunk,
  REFRESH_TIME_BUDGET_MS, ADS_VOLUME_CONCURRENCY, type SyncDeps,
} from './meta-pages';
import { normalizeProfiles, type ProfileSyncState } from './sync-jobs';

describe('tokensForAccount', () => {
  const map = new Map([['P142', 'tokA'], ['106 v2', 'tokB']]);

  it('returns tokens for the accessible profiles, in order', () => {
    expect(tokensForAccount(['P142', '106 v2'], map)).toEqual(['tokA', 'tokB']);
  });
  it('skips profiles with no live token', () => {
    expect(tokensForAccount(['ghost', 'P142'], map)).toEqual(['tokA']);
  });
  it('returns empty when nothing matches', () => {
    expect(tokensForAccount([], map)).toEqual([]);
    expect(tokensForAccount(['ghost'], map)).toEqual([]);
  });
  it('dedupes repeated tokens', () => {
    const m2 = new Map([['a', 'tok'], ['b', 'tok']]);
    expect(tokensForAccount(['a', 'b'], m2)).toEqual(['tok']);
  });
});

describe('selectProfiles', () => {
  const all = [
    { name: 'P251', token: 't251' },
    { name: 'p133', token: 't133' },
    { name: 'Ghost', token: '' }, // no live token
  ];

  it('returns all profiles with a token when no names given', () => {
    expect(selectProfiles(all).map((p) => p.name)).toEqual(['P251', 'p133']);
    expect(selectProfiles(all, []).map((p) => p.name)).toEqual(['P251', 'p133']);
  });
  it('filters to the requested names, case/space-insensitive', () => {
    expect(selectProfiles(all, [' p251 ']).map((p) => p.name)).toEqual(['P251']);
    expect(selectProfiles(all, ['P133', 'P251']).map((p) => p.name)).toEqual(['P251', 'p133']);
  });
  it('never returns a profile without a live token', () => {
    expect(selectProfiles(all, ['Ghost'])).toEqual([]);
  });
  it('ignores names that match nothing', () => {
    expect(selectProfiles(all, ['nope'])).toEqual([]);
  });
});

describe('foldAdsVolumeRows', () => {
  it('keeps MAX limit and MAX running per actor across rows', () => {
    const { limits, running, names } = foldAdsVolumeRows([
      { actor_id: 'A', actor_name: 'Page A', limit_on_ads_running_or_in_review: 250, ads_running_or_in_review_count: 10 },
      { actor_id: 'A', limit_on_ads_running_or_in_review: 1000, ads_running_or_in_review_count: 7 },
      { actor_id: 'B', actor_name: 'Page B', limit_on_ads_running_or_in_review: 250, ads_running_or_in_review_count: 3 },
    ]);
    expect(limits.get('A')).toBe(1000);
    expect(running.get('A')).toBe(10);
    expect(limits.get('B')).toBe(250);
    expect(names.get('A')).toBe('Page A');
  });
  it('accumulates into an existing accumulator (multi-account merge)', () => {
    const acc = foldAdsVolumeRows([{ actor_id: 'A', limit_on_ads_running_or_in_review: 250, ads_running_or_in_review_count: 5 }]);
    foldAdsVolumeRows([{ actor_id: 'A', limit_on_ads_running_or_in_review: 100, ads_running_or_in_review_count: 9 }], acc);
    expect(acc.limits.get('A')).toBe(250); // MAX, not overwritten by the smaller later value
    expect(acc.running.get('A')).toBe(9);
  });
  it('ignores rows without actor_id and missing numeric fields', () => {
    const { limits, running } = foldAdsVolumeRows([
      { actor_name: 'no id' },
      { actor_id: 'C' }, // no numbers
    ]);
    expect(limits.has('C')).toBe(false);
    expect(running.has('C')).toBe(false);
  });
});

describe('orderProfilesBySize', () => {
  it('sorts ascending by account count, unknown counts first (0)', () => {
    const profiles = [{ name: 'p133' }, { name: 'P253' }, { name: 'novo' }];
    const counts = new Map([['p133', 628], ['P253', 1]]);
    expect(orderProfilesBySize(profiles, counts).map((p) => p.name)).toEqual(['novo', 'P253', 'p133']);
  });
  it('breaks count ties by name (stable across runs)', () => {
    const profiles = [{ name: 'B' }, { name: 'A' }];
    expect(orderProfilesBySize(profiles, new Map()).map((p) => p.name)).toEqual(['A', 'B']);
  });
  it('does not mutate the input array', () => {
    const profiles = [{ name: 'B' }, { name: 'A' }];
    orderProfilesBySize(profiles, new Map());
    expect(profiles.map((p) => p.name)).toEqual(['B', 'A']);
  });
});

describe('applyPersistedOrder', () => {
  it('reorders profiles to match the persisted name order', () => {
    const profiles = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
    expect(applyPersistedOrder(profiles, ['C', 'A', 'B']).map((p) => p.name)).toEqual(['C', 'A', 'B']);
  });
  it('appends profiles missing from the order at the end, keeping their order', () => {
    const profiles = [{ name: 'novo2' }, { name: 'A' }, { name: 'novo1' }];
    expect(applyPersistedOrder(profiles, ['A']).map((p) => p.name)).toEqual(['A', 'novo2', 'novo1']);
  });
  it('returns profiles unchanged when order is null/empty', () => {
    const profiles = [{ name: 'B' }, { name: 'A' }];
    expect(applyPersistedOrder(profiles, null).map((p) => p.name)).toEqual(['B', 'A']);
    expect(applyPersistedOrder(profiles, []).map((p) => p.name)).toEqual(['B', 'A']);
  });
});

describe('normalizeProfiles (dedupe key)', () => {
  it('null/empty/blank-only lists mean "all profiles"', () => {
    expect(normalizeProfiles(undefined)).toBeNull();
    expect(normalizeProfiles([])).toBeNull();
    expect(normalizeProfiles(['  ', ''])).toBeNull();
  });
  it('trims, dedupes case-insensitively (keeps first casing) and sorts', () => {
    expect(normalizeProfiles([' P253 ', 'p133', 'P253', 'p253'])).toEqual(['p133', 'P253']);
  });
  it('same set in different order produces the same key', () => {
    expect(normalizeProfiles(['B', 'A'])).toEqual(normalizeProfiles(['A', 'B']));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runProfileSyncChunk — state machine com deps injetadas (sem rede/DB reais)
// ─────────────────────────────────────────────────────────────────────────────

type FetchLog = { kind: 'pages' | 'adaccounts' | 'ads_volume'; token: string; account?: string };

function okResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return { headers: new Headers(headers), json: async () => body } as unknown as Response;
}

interface FakeGraphOpts {
  // por token:
  pages?: Record<string, { id: string; name?: string }[]>;
  accounts?: Record<string, string[]>;
  adsVolume?: (account: string, token: string) => unknown; // corpo da resposta
  errorFor?: (kind: FetchLog['kind'], token: string) => { body: unknown; headers?: Record<string, string> } | null;
  onCall?: (log: FetchLog) => void | Promise<void>;
}

function fakeGraphFetch(opts: FakeGraphOpts, log: FetchLog[]) {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const token = url.searchParams.get('access_token') ?? '';
    const kind: FetchLog['kind'] = url.pathname.includes('/me/accounts')
      ? 'pages'
      : url.pathname.includes('/me/adaccounts')
        ? 'adaccounts'
        : 'ads_volume';
    const account = kind === 'ads_volume' ? url.pathname.split('/')[2] : undefined;
    const entry: FetchLog = { kind, token, account };
    log.push(entry);
    await opts.onCall?.(entry);

    const err = opts.errorFor?.(kind, token);
    if (err) return okResponse(err.body, err.headers);

    if (kind === 'pages') return okResponse({ data: opts.pages?.[token] ?? [] });
    if (kind === 'adaccounts') return okResponse({ data: (opts.accounts?.[token] ?? []).map((id) => ({ id })) });
    return okResponse(opts.adsVolume?.(account!, token) ?? { data: [] });
  }) as unknown as typeof fetch;
}

function fakeDb(accountCounts: Record<string, number> = {}) {
  const writes: { sql: string; params?: unknown[] }[] = [];
  const db: SyncDeps['db'] = {
    query: async (sql: string) => {
      if (sql.includes('unnest(accessible_profiles)')) {
        return { rows: Object.entries(accountCounts).map(([profile, n]) => ({ profile, n })) };
      }
      return { rows: [] };
    },
    connect: async () => ({
      query: async (sql: string, params?: unknown[]) => { writes.push({ sql, params }); return { rows: [] }; },
      release: () => {},
    }),
  };
  return { db, writes };
}

const FRESH_STATE: ProfileSyncState = { profileIndex: 0, phase: 'pages', accounts: null, accountOffset: 0, failed: [], order: null };

function makeDeps(over: Partial<SyncDeps>): Partial<SyncDeps> {
  return { now: () => Date.now(), sleep: async () => {}, ...over };
}

describe('runProfileSyncChunk — multi-perfil por chunk', () => {
  it('completes ALL profiles in one chunk when the budget allows (antes: 1 perfil/chunk)', async () => {
    const log: FetchLog[] = [];
    const { db, writes } = fakeDb({ A: 5, B: 1 });
    const r = await runProfileSyncChunk({
      state: FRESH_STATE,
      deps: makeDeps({
        db,
        getProfiles: async () => [{ name: 'A', token: 'tA' }, { name: 'B', token: 'tB' }],
        fetchImpl: fakeGraphFetch({
          pages: { tA: [{ id: 'pg1', name: 'Página 1' }], tB: [{ id: 'pg2' }] },
          accounts: { tA: ['act_1'], tB: [] },
          adsVolume: () => ({ data: [{ actor_id: 'pg1', limit_on_ads_running_or_in_review: 250, ads_running_or_in_review_count: 3 }] }),
        }, log),
      }),
    });
    expect(r.done).toBe(true);
    expect(r.partial).toBe(false);
    expect(r.total).toBe(2);
    expect(r.state.profileIndex).toBe(2);
    // páginas dos DOIS perfis upsertadas no mesmo chunk
    expect(writes.filter((w) => w.sql.includes('INSERT INTO meta_pages')).length).toBe(2);
    // limites do pg1 gravados
    expect(writes.some((w) => w.sql.includes('UPDATE meta_pages') && w.params?.[0] === 'pg1')).toBe(true);
  });

  it('fixes profile order on the first chunk (smallest first) and persists it in state', async () => {
    const log: FetchLog[] = [];
    const { db } = fakeDb({ giant: 600, tiny: 2 });
    const r = await runProfileSyncChunk({
      state: FRESH_STATE,
      deps: makeDeps({
        db,
        getProfiles: async () => [{ name: 'giant', token: 'tG' }, { name: 'tiny', token: 'tT' }],
        fetchImpl: fakeGraphFetch({}, log),
      }),
    });
    expect(r.state.order).toEqual(['tiny', 'giant']);
    // tiny processado primeiro
    expect(log[0]).toMatchObject({ kind: 'pages', token: 'tT' });
  });

  it('freezes the LEGACY config order for an in-flight job without `order` (deploy migration)', async () => {
    // Job de antes do deploy: no meio da fase de limites do 1º perfil da ordem
    // ANTIGA (= ordem de configuração), sem `order` no state. Reordenar aqui
    // aplicaria as contas cacheadas ao token do perfil errado.
    const log: FetchLog[] = [];
    const { db } = fakeDb({ giant: 600, tiny: 2 }); // reordenação sugeriria tiny primeiro
    const r = await runProfileSyncChunk({
      state: { profileIndex: 0, phase: 'limits', accounts: ['act_g1'], accountOffset: 0, failed: [] },
      deps: makeDeps({
        db,
        getProfiles: async () => [{ name: 'giant', token: 'tG' }, { name: 'tiny', token: 'tT' }],
        fetchImpl: fakeGraphFetch({}, log),
      }),
    });
    expect(r.state.order).toEqual(['giant', 'tiny']); // ordem de config congelada
    // contas cacheadas processadas com o token do giant (índice 0 legado)
    expect(log[0]).toMatchObject({ kind: 'ads_volume', token: 'tG', account: 'act_g1' });
  });

  it('resumes with the persisted order even if it disagrees with current counts', async () => {
    const log: FetchLog[] = [];
    const { db } = fakeDb({ A: 1, B: 600 });
    const r = await runProfileSyncChunk({
      state: { ...FRESH_STATE, order: ['B', 'A'], profileIndex: 1 }, // B já feito
      deps: makeDeps({
        db,
        getProfiles: async () => [{ name: 'A', token: 'tA' }, { name: 'B', token: 'tB' }],
        fetchImpl: fakeGraphFetch({}, log),
      }),
    });
    expect(r.done).toBe(true);
    // índice 1 na ordem persistida = A; B não é re-sincronizado
    expect(log.every((l) => l.token === 'tA')).toBe(true);
  });

  it('skips a profile with an expired token and CONTINUES to the next in the same chunk', async () => {
    const log: FetchLog[] = [];
    const { db } = fakeDb();
    const r = await runProfileSyncChunk({
      state: FRESH_STATE,
      deps: makeDeps({
        db,
        getProfiles: async () => [{ name: 'morto', token: 'tDead' }, { name: 'vivo', token: 'tOk' }],
        fetchImpl: fakeGraphFetch({
          errorFor: (kind, token) => (token === 'tDead' && kind === 'pages')
            ? { body: { error: { code: 190, message: 'token expirado' } } }
            : null,
          pages: { tOk: [{ id: 'pg9' }] },
        }, log),
      }),
    });
    expect(r.done).toBe(true);
    expect(r.state.failed).toEqual(['morto']);
    expect(log.some((l) => l.token === 'tOk')).toBe(true); // vivo processado no MESMO chunk
  });

  it('stops between profiles when the time budget is exhausted and resumes from state', async () => {
    let t = 0;
    const log: FetchLog[] = [];
    const { db } = fakeDb({ A: 1, B: 2 });
    const deps = makeDeps({
      db,
      now: () => t,
      getProfiles: async () => [{ name: 'A', token: 'tA' }, { name: 'B', token: 'tB' }],
      fetchImpl: fakeGraphFetch({
        onCall: (l) => {
          // terminar o perfil A consome o orçamento inteiro
          if (l.token === 'tA' && l.kind === 'adaccounts') t += REFRESH_TIME_BUDGET_MS + 1000;
        },
      }, log),
    });

    const r1 = await runProfileSyncChunk({ state: FRESH_STATE, deps });
    expect(r1.done).toBe(false);
    expect(r1.partial).toBe(false);
    expect(r1.state.profileIndex).toBe(1); // A concluído (0 contas na fase limits)
    expect(log.some((l) => l.token === 'tB')).toBe(false); // B NÃO começou

    const r2 = await runProfileSyncChunk({ state: r1.state, deps });
    expect(r2.done).toBe(true);
    expect(log.some((l) => l.token === 'tB')).toBe(true);
  });
});

describe('runProfileSyncChunk — rate limit (#4) e deadline', () => {
  const buc4 = {
    body: { error: { code: 4, message: 'Application request limit reached' } },
    headers: { 'x-app-usage': JSON.stringify({ call_count: 10 }) }, // app baixo → BUC
  };

  it('#4 BUC na fase de páginas vira parcial resumível (antes: matava o job)', async () => {
    const { db } = fakeDb();
    const sleeps: number[] = [];
    const r = await runProfileSyncChunk({
      state: FRESH_STATE,
      deps: makeDeps({
        db,
        sleep: async (ms) => { sleeps.push(ms); },
        getProfiles: async () => [{ name: 'A', token: 'tA' }],
        fetchImpl: fakeGraphFetch({ errorFor: (kind) => (kind === 'pages' ? buc4 : null) }, []),
      }),
    });
    expect(r.partial).toBe(true);
    expect(r.done).toBe(false);
    expect(r.state.profileIndex).toBe(0); // retoma o MESMO perfil no próximo tick
    expect(r.state.phase).toBe('pages');
    expect(sleeps.filter((ms) => ms >= 30000).length).toBeGreaterThan(0); // tentou backoff BUC
  });

  it('backoff de #4 não cruza o deadline do chunk: desiste na hora, sem dormir 30-60s', async () => {
    let t = 0;
    const sleeps: number[] = [];
    const { db } = fakeDb();
    const r = await runProfileSyncChunk({
      state: FRESH_STATE,
      deps: makeDeps({
        db,
        now: () => t,
        sleep: async (ms) => { sleeps.push(ms); },
        getProfiles: async () => [{ name: 'A', token: 'tA' }],
        fetchImpl: fakeGraphFetch({
          errorFor: (kind) => (kind === 'pages' ? buc4 : null),
          onCall: () => { t = REFRESH_TIME_BUDGET_MS - 10_000; }, // perto do fim do orçamento
        }, []),
      }),
    });
    expect(r.partial).toBe(true);
    expect(sleeps.filter((ms) => ms >= 30000)).toEqual([]); // NUNCA dormiu além do deadline
  });

  it('#4 BUC na fase de limites preserva o offset do lote para retomar', async () => {
    const { db } = fakeDb();
    const r = await runProfileSyncChunk({
      state: { ...FRESH_STATE, phase: 'limits', accounts: ['act_1', 'act_2'], order: ['A'] },
      deps: makeDeps({
        db,
        getProfiles: async () => [{ name: 'A', token: 'tA' }],
        fetchImpl: fakeGraphFetch({ errorFor: (kind) => (kind === 'ads_volume' ? buc4 : null) }, []),
      }),
    });
    expect(r.partial).toBe(true);
    expect(r.state.accountOffset).toBe(0); // lote refeito no próximo tick (idempotente)
    expect(r.state.phase).toBe('limits');
  });
});

describe('runProfileSyncChunk — paralelismo do ads_volume', () => {
  it('runs ads_volume calls concurrently within a batch', async () => {
    let inflight = 0;
    let maxInflight = 0;
    const accounts = Array.from({ length: ADS_VOLUME_CONCURRENCY * 2 }, (_, i) => `act_${i}`);
    const { db } = fakeDb();
    const r = await runProfileSyncChunk({
      state: { ...FRESH_STATE, phase: 'limits', accounts, order: ['A'] },
      deps: makeDeps({
        db,
        getProfiles: async () => [{ name: 'A', token: 'tA' }],
        fetchImpl: fakeGraphFetch({
          onCall: async () => {
            inflight++;
            maxInflight = Math.max(maxInflight, inflight);
            await new Promise((res) => setTimeout(res, 5));
            inflight--;
          },
        }, []),
      }),
    });
    expect(r.done).toBe(true);
    expect(maxInflight).toBe(ADS_VOLUME_CONCURRENCY);
  });

  it('reports progress with a state snapshot so the worker can persist mid-chunk', async () => {
    const snapshots: (ProfileSyncState | undefined)[] = [];
    const { db } = fakeDb();
    await runProfileSyncChunk({
      state: { ...FRESH_STATE, phase: 'limits', accounts: ['act_1'], order: ['A'] },
      onProgress: (p) => snapshots.push(p.state),
      deps: makeDeps({
        db,
        getProfiles: async () => [{ name: 'A', token: 'tA' }],
        fetchImpl: fakeGraphFetch({}, []),
      }),
    });
    const withOffset = snapshots.filter((s) => s && s.accountOffset === 1);
    expect(withOffset.length).toBeGreaterThan(0); // snapshot contém o avanço do lote
  });
});
