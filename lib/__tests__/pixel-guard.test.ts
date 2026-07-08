import { describe, it, expect, vi, afterEach } from 'vitest';
import { shouldResetOrphanPixel, pixelSubmitErrors } from '../pixel-guard';
import { preflightPixelGuard, createCampaignBatch } from '../meta-campaigns';
import type { BatchRunState, BatchRunOpts } from '../batch-contract';

// ─────────────────────────────────────────────────────────────────────────────
// Camada 1 (builder) — spec 2026-07-07-pixel-guard-design.md.
// Bug original: trocar de conta deixava um pixelId da conta anterior no estado;
// o SearchableSelect renderizava vazio mas o submit publicava o ID velho.
// ─────────────────────────────────────────────────────────────────────────────

describe('shouldResetOrphanPixel', () => {
  const base = { pixelId: 'px_A', pixelIds: ['px_B', 'px_C'], loading: false, error: null };

  it('reseta quando a lista carregou sem o pixel selecionado (pixel órfão)', () => {
    expect(shouldResetOrphanPixel(base)).toBe(true);
  });

  it('não reseta enquanto a lista está carregando (lista pode estar stale/vazia)', () => {
    expect(shouldResetOrphanPixel({ ...base, loading: true })).toBe(false);
  });

  it('não reseta sob erro de fetch (lista vazia por falha transitória ≠ sem acesso)', () => {
    expect(shouldResetOrphanPixel({ ...base, error: 'HTTP 502' })).toBe(false);
  });

  it('não reseta quando o pixel pertence à lista', () => {
    expect(shouldResetOrphanPixel({ ...base, pixelIds: ['px_A', 'px_B'] })).toBe(false);
  });

  it('no-op com pixelId vazio', () => {
    expect(shouldResetOrphanPixel({ ...base, pixelId: '' })).toBe(false);
  });

  it('reseta quando a conta não tem pixel nenhum (lista carregada vazia)', () => {
    expect(shouldResetOrphanPixel({ ...base, pixelIds: [] })).toBe(true);
  });
});

describe('pixelSubmitErrors', () => {
  it('engagement não usa pixel — nunca erra', () => {
    expect(pixelSubmitErrors({ isEngagement: true, pixelId: '', pixelIds: [] })).toEqual([]);
  });

  it('vendas sem pixel → "Selecione um pixel." (trava existente, preservada)', () => {
    expect(pixelSubmitErrors({ isEngagement: false, pixelId: '', pixelIds: ['px_B'] }))
      .toEqual(['Selecione um pixel.']);
  });

  it('vendas com pixel fora da lista da conta → erro de pertencimento', () => {
    expect(pixelSubmitErrors({ isEngagement: false, pixelId: 'px_A', pixelIds: ['px_B'] }))
      .toEqual(['O pixel selecionado não pertence a esta conta.']);
  });

  it('vendas com pixel válido → sem erros', () => {
    expect(pixelSubmitErrors({ isEngagement: false, pixelId: 'px_B', pixelIds: ['px_B'] }))
      .toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Camada 2 (worker) — pre-flight ANTES de criar qualquer entidade. O throw é
// capturado por processJob, que finaliza o job 'error' com a mensagem.
// ─────────────────────────────────────────────────────────────────────────────

describe('preflightPixelGuard', () => {
  const base = {
    account_id: 'act_1',
    access_token: 'tok',
    campaign: { objective: 'OUTCOME_SALES' },
    adset: { promoted_object: { pixel_id: 'px_ok' } },
  };

  it('vendas sem pixel_id → lança sem nem consultar a Meta', async () => {
    const listMock = vi.fn();
    await expect(
      preflightPixelGuard({ ...base, adset: { promoted_object: {} } }, listMock)
    ).rejects.toThrow('Campanha de vendas sem pixel — selecione um pixel no builder.');
    expect(listMock).not.toHaveBeenCalled();
  });

  it('pixel fora da lista de adspixels da conta → lança com mensagem acionável', async () => {
    const listMock = vi.fn(async () => [{ id: 'px_other' }]);
    await expect(preflightPixelGuard(base, listMock)).rejects.toThrow(
      'A conta act_1 não tem acesso ao pixel px_ok — selecione um pixel desta conta (trava pré-publicação: nenhuma campanha/conjunto/anúncio foi criado).'
    );
    expect(listMock).toHaveBeenCalledWith('act_1', 'tok');
  });

  it('pixel presente na lista → prossegue', async () => {
    const listMock = vi.fn(async () => [{ id: 'px_ok' }, { id: 'px_other' }]);
    await expect(preflightPixelGuard(base, listMock)).resolves.toBeUndefined();
  });

  it('engagement pula o pre-flight inteiro', async () => {
    const listMock = vi.fn();
    await expect(
      preflightPixelGuard(
        { ...base, campaign: { objective: 'OUTCOME_ENGAGEMENT' }, adset: { promoted_object: {} } },
        listMock
      )
    ).resolves.toBeUndefined();
    expect(listMock).not.toHaveBeenCalled();
  });

  it('erro na checagem (rate limit/rede) → fail-open: avisa e prossegue', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const listMock = vi.fn(async () => { throw new Error('(#4) rate limit'); });
    await expect(preflightPixelGuard(base, listMock)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('página cheia (>=100 pixels) sem match → inconclusivo, fail-open com aviso', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const listMock = vi.fn(async () =>
      Array.from({ length: 100 }, (_, i) => ({ id: `px_${i}` }))
    );
    await expect(preflightPixelGuard(base, listMock)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('createCampaignBatch — pre-flight integrado', () => {
  const origFetch = global.fetch;
  afterEach(() => {
    global.fetch = origFetch;
    vi.restoreAllMocks();
  });

  const opts = (runState: BatchRunState): BatchRunOpts => ({
    onEvent: async () => {},
    runState,
    shouldAbort: () => false,
  });

  // Fixture mínimo (espelha makeInput de separation-grouping.test.ts) — vendas
  // SEM pixel no promoted_object.
  const inputSemPixel = () => ({
    account_id: 'act_test',
    access_token: 'tok',
    campaigns_per_creative: 1,
    adsets_per_campaign: 1,
    ads_per_adset: 1,
    page_ids: ['pageA'],
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
      promoted_object: { custom_event_type: 'PURCHASE' }, // sem pixel_id
      targeting: { geo_locations: { countries: ['BR'] } },
      status: 'PAUSED',
    },
    creatives: [
      {
        name: 'Criativo 1',
        creative: {
          name: 'Criativo 1',
          page_id: 'pageA',
          instagram_user_id: 'ig_1',
          type: 'single' as const,
          link: 'https://x.test',
          image_hash: 'hash123',
          message: 'oi',
        },
      },
    ],
  });

  it('run fresco de vendas sem pixel falha ANTES de qualquer chamada à Graph', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('não deveria chamar a Graph'); });
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(
      createCampaignBatch(inputSemPixel() as any, opts({ created: {}, failed: {} }))
    ).rejects.toThrow('Campanha de vendas sem pixel');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('RESUME (runState não vazio) pula o pre-flight — não erra job parcialmente criado', async () => {
    // Mesmo input sem pixel: com uma campanha já criada no runState, o guard não
    // pode lançar. O run segue e cria adset/ad via fetch mockado.
    let id = 0;
    const fetchMock = vi.fn(async () =>
      ({
        ok: true, status: 200, statusText: 'OK',
        headers: { get: () => null },
        json: async () => ({ id: `ent_${id++}` }),
      }) as unknown as Response
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const runState: BatchRunState = { created: { 'c:0:0': 'camp_1' }, failed: {} };
    const result = await createCampaignBatch(inputSemPixel() as any, opts(runState));
    expect(result.aborted).toBe(false);
    // adset + creative + ad criados no resume (a campanha já existia).
    expect(fetchMock).toHaveBeenCalled();
  });

  it('run com só checkpoints de mídia do Drive (m:<idx>) ainda é tratado como fresco — guard dispara', async () => {
    // Achado C1 do review final: resolveDriveMedia roda antes do batch e grava
    // checkpoints m:<idx> no runState.created. Sem o filtro de prefixo, isso
    // fazia freshRun=false e a trava de pixel nunca disparava para jobs com
    // mídia do Drive.
    const fetchMock = vi.fn(async () => { throw new Error('não deveria chamar a Graph'); });
    global.fetch = fetchMock as unknown as typeof fetch;
    const runState: BatchRunState = { created: { 'm:0': 'img:hash123' }, failed: {} };
    await expect(
      createCampaignBatch(inputSemPixel() as any, opts(runState))
    ).rejects.toThrow('Campanha de vendas sem pixel');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
