# Trava de Pixel (duas camadas) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Impedir que uma campanha seja publicada com pixel ausente ou com pixel ao qual a conta de anúncios não tem acesso (spec: `docs/superpowers/specs/2026-07-07-pixel-guard-design.md`).

**Architecture:** Duas camadas. (1) Builder: um efeito reseta o `pixelId` órfão quando a lista de pixels da conta carrega sem ele, e a validação de submit passa a checar pertencimento além de presença — ambos via helpers puros novos em `lib/pixel-guard.ts`. (2) Worker: pre-flight `preflightPixelGuard` no início de `createCampaignBatch` (apenas em runs frescos), que falha o job com mensagem clara ANTES de criar qualquer entidade; a checagem de acesso usa o `listPixels` existente e é fail-open em erro transitório.

**Tech Stack:** Next.js (app router), TypeScript, vitest. Worker roda Node; Graph API v22 via helpers existentes (`getGraph`/`listPixels` em `lib/meta-campaigns.ts`).

## Global Constraints

- Working dir dos comandos: `c:\Apps\REPORT\app` (repo git; commits em master local, sem push).
- Mensagens de erro em pt-BR, copiadas verbatim deste plano.
- Nunca usar `new Date()`/`Date.now()` crus em código de app (regra do projeto — não é necessário aqui).
- Um job em RESUME (runState não vazio) NUNCA passa pelo pre-flight — jamais errar um job parcialmente criado.
- `tsc --noEmit`, `vitest run` (suite completa) e `next build` verdes antes do commit final.
- Não mexer na rota `/api/campaigns/create` (fora de escopo por spec).

---

### Task 1: Helpers puros `lib/pixel-guard.ts` (camada 1, lógica)

**Files:**
- Create: `lib/pixel-guard.ts`
- Test: `lib/__tests__/pixel-guard.test.ts`

**Interfaces:**
- Consumes: nada (funções puras).
- Produces (usados na Task 3):
  - `shouldResetOrphanPixel(args: { pixelId: string; pixelIds: string[]; loading: boolean; error: string | null }): boolean`
  - `pixelSubmitErrors(args: { isEngagement: boolean; pixelId: string; pixelIds: string[] }): string[]`

- [ ] **Step 1: Write the failing tests**

Criar `lib/__tests__/pixel-guard.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shouldResetOrphanPixel, pixelSubmitErrors } from '../pixel-guard';

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/__tests__/pixel-guard.test.ts`
Expected: FAIL — `Cannot find module '../pixel-guard'` (ou equivalente).

- [ ] **Step 3: Write minimal implementation**

Criar `lib/pixel-guard.ts`:

```ts
// Trava de pixel — camada 1 (builder). Spec: docs/superpowers/specs/
// 2026-07-07-pixel-guard-design.md. Helpers puros para o ClientCampaignBuilder:
// o estado pixelId sobrevive à troca de conta, então o select pode renderizar
// vazio enquanto o submit publica um pixel de OUTRA conta (Meta subcode 1815045
// só no meio da fila, com campanha/conjunto já criados).

/**
 * Pixel órfão: a lista de pixels da conta terminou de carregar (sem erro) e o
 * pixelId selecionado não está nela → o builder deve resetar para '' (o
 * auto-select então escolhe o primeiro pixel da conta nova, ou o campo fica
 * vazio e a validação de presença bloqueia o submit).
 * Não decide nada durante loading nem sob erro de fetch: nesses estados a
 * lista pode estar vazia/stale por falha transitória, não por falta de acesso.
 */
export function shouldResetOrphanPixel(args: {
  pixelId: string;
  pixelIds: string[];
  loading: boolean;
  error: string | null;
}): boolean {
  const { pixelId, pixelIds, loading, error } = args;
  return pixelId !== '' && !loading && error === null && !pixelIds.includes(pixelId);
}

/**
 * Erros de submit relativos a pixel (substitui o check inline de presença que
 * vivia no builder): presença E pertencimento à conta. Engagement (PAGE_LIKES)
 * não usa pixel.
 */
export function pixelSubmitErrors(args: {
  isEngagement: boolean;
  pixelId: string;
  pixelIds: string[];
}): string[] {
  const { isEngagement, pixelId, pixelIds } = args;
  if (isEngagement) return [];
  if (!pixelId) return ['Selecione um pixel.'];
  if (!pixelIds.includes(pixelId)) return ['O pixel selecionado não pertence a esta conta.'];
  return [];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/__tests__/pixel-guard.test.ts`
Expected: PASS (10 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/pixel-guard.ts lib/__tests__/pixel-guard.test.ts
git commit -m "feat: helpers puros da trava de pixel (reset de órfão + validação de pertencimento)"
```

---

### Task 2: Pre-flight no worker (`createCampaignBatch`) — camada 2

**Files:**
- Modify: `lib/meta-campaigns.ts` (nova função exportada + chamada no início de `createCampaignBatch`, ~linha 1993)
- Test: `lib/__tests__/pixel-guard.test.ts` (mesmo arquivo da Task 1, novos describes)

**Interfaces:**
- Consumes: `listPixels(accountId, token)` já exportado em `lib/meta-campaigns.ts:520` (GET `act_X/adspixels`, limit 100).
- Produces: `preflightPixelGuard(args: { account_id: string; access_token: string; campaign: { objective?: string }; adset: { promoted_object?: { pixel_id?: string } } }, listPixelsFn?): Promise<void>` — lança `Error` com mensagem pt-BR quando a publicação deve ser travada. O `throw` dentro de `createCampaignBatch` é capturado por `processJob` (`lib/campaign-jobs.ts:704-708`), que finaliza o job como `error` com a mensagem — nenhuma entidade criada.

**Contexto para quem implementa:**
- `createCampaignBatch` começa em `lib/meta-campaigns.ts:1966`; destrutura `account_id`, `access_token`, `campaign: campaignTpl`, `adset: adsetTpl` do input e `runState` de `opts` (linhas 1970-1991). `const level ...` fica na linha ~1993 — inserir o pre-flight logo APÓS essa linha.
- Os testes existentes (`separation-grouping.test.ts`) mockam `global.fetch` com rotas que LANÇAM em paths inesperados (`/adspixels` não é roteado). O fail-open do pre-flight absorve isso: `listPixels` rejeita → warn + prossegue → testes existentes continuam verdes. Os fixtures deles têm `objective: 'OUTCOME_SALES'` + `pixel_id: 'px'`, então o check determinístico de presença também passa.

- [ ] **Step 1: Write the failing tests**

Acrescentar ao FINAL de `lib/__tests__/pixel-guard.test.ts`:

```ts
import { vi, afterEach } from 'vitest';
import { preflightPixelGuard, createCampaignBatch } from '../meta-campaigns';
import type { BatchRunState, BatchRunOpts } from '../batch-contract';

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
      'A conta act_1 não tem acesso ao pixel px_ok — selecione um pixel desta conta (trava pré-publicação: nada foi criado).'
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/__tests__/pixel-guard.test.ts`
Expected: FAIL — `preflightPixelGuard` não é exportado de `../meta-campaigns` (os describes novos falham; os da Task 1 seguem verdes).

- [ ] **Step 3: Implement `preflightPixelGuard` + call site**

Em `lib/meta-campaigns.ts`, logo APÓS a função `listPixels` (linha ~527), adicionar:

```ts
/**
 * Trava de pixel — camada 2 (worker). Spec: docs/superpowers/specs/
 * 2026-07-07-pixel-guard-design.md. Roda no início de createCampaignBatch,
 * ANTES de criar qualquer entidade, e SÓ em runs frescos (resume nunca passa
 * aqui — jamais errar um job parcialmente criado).
 *
 * - Vendas (OUTCOME_SALES) sem pixel_id → Error: o processJob captura e
 *   finaliza o job 'error' com a mensagem, sem criar nada.
 * - pixel_id presente → confirma acesso via act_{id}/adspixels (listPixels);
 *   sem acesso → Error idem. Cobre broadcast multi-conta e re-enfileiramento,
 *   onde o builder não consegue validar (o pixel exibido é o da conta primária).
 * - Erro na PRÓPRIA checagem (rate limit #4/#17, rede) → fail-open: loga aviso
 *   e prossegue — a Meta ainda rejeita na criação, como antes da trava. O guard
 *   existe para falhar cedo e limpo, não para criar novo ponto de indisponibilidade.
 * - OUTCOME_ENGAGEMENT (PAGE_LIKES) não usa pixel: skip total.
 *
 * `listPixelsFn` é injetável só para os testes unitários.
 */
export async function preflightPixelGuard(
  args: {
    account_id: string;
    access_token: string;
    campaign: { objective?: string };
    adset: { promoted_object?: { pixel_id?: string } };
  },
  listPixelsFn: (accountId: string, token: string) => Promise<{ id: string }[]> = listPixels
): Promise<void> {
  const objective = args.campaign?.objective;
  const pixelId = args.adset?.promoted_object?.pixel_id;
  if (objective === 'OUTCOME_ENGAGEMENT') return;
  if (objective === 'OUTCOME_SALES' && !pixelId) {
    throw new Error('Campanha de vendas sem pixel — selecione um pixel no builder.');
  }
  if (!pixelId) return;
  let pixels: { id: string }[];
  try {
    pixels = await listPixelsFn(args.account_id, args.access_token);
  } catch (e) {
    console.warn(
      '[pixel-guard] checagem de acesso ao pixel falhou (fail-open, prosseguindo):',
      e instanceof Error ? e.message : String(e)
    );
    return;
  }
  if (!pixels.some((p) => p.id === pixelId)) {
    throw new Error(
      `A conta ${args.account_id} não tem acesso ao pixel ${pixelId} — selecione um pixel desta conta (trava pré-publicação: nada foi criado).`
    );
  }
}
```

Em `createCampaignBatch`, logo APÓS `const level: SeparationLevel = separation_level ?? 'campaign';` (linha ~1993), inserir:

```ts
  // ── Trava de pixel (pre-flight): só em run FRESCO — um resume já criou
  // entidades e não pode ser errado retroativamente pelo guard. ────────────────
  const freshRun =
    Object.keys(runState.created).length === 0 && Object.keys(runState.failed).length === 0;
  if (freshRun) {
    await preflightPixelGuard({
      account_id,
      access_token,
      campaign: campaignTpl,
      adset: adsetTpl,
    });
  }
```

- [ ] **Step 4: Run new tests to verify they pass**

Run: `npx vitest run lib/__tests__/pixel-guard.test.ts`
Expected: PASS (17 testes).

- [ ] **Step 5: Run the FULL suite (regressão — fixtures existentes têm pixel 'px' e fetch mock sem rota /adspixels; o fail-open absorve)**

Run: `npx vitest run`
Expected: PASS, 0 falhas (274+ testes; pode aparecer `console.warn [pixel-guard] ...` nos testes de separation-grouping — esperado, não é falha).

- [ ] **Step 6: Commit**

```bash
git add lib/meta-campaigns.ts lib/__tests__/pixel-guard.test.ts
git commit -m "feat: pre-flight de pixel no worker — falha o job antes de criar qualquer entidade"
```

---

### Task 3: Integração no builder (reset de órfão + validação) e verificação final

**Files:**
- Modify: `app/campaigns/ClientCampaignBuilder.tsx` (import + efeito após linha ~2140 + validação nas linhas ~2502-2504)

**Interfaces:**
- Consumes: `shouldResetOrphanPixel` e `pixelSubmitErrors` de `@/lib/pixel-guard` (Task 1); estados existentes `pixelId`/`setPixelId` (linha 1791), `pixels` (linha 1450), `pixelsRes` (linha 1415), `isEngagement`, `errors` (bloco ~2499).
- Produces: nada consumido por outras tasks.

- [ ] **Step 1: Add import**

No topo de `app/campaigns/ClientCampaignBuilder.tsx`, junto aos imports de `@/lib/...` existentes:

```ts
import { shouldResetOrphanPixel, pixelSubmitErrors } from '@/lib/pixel-guard';
```

- [ ] **Step 2: Add orphan-reset effect**

Localizar o auto-select (linha ~2140):

```ts
  useEffect(() => { if (!pixelId && pixels[0]) setPixelId(pixels[0].id); }, [pixels, pixelId]);
```

Inserir IMEDIATAMENTE ABAIXO dele:

```ts
  // Pixel órfão (trava de pixel, camada 1): ao trocar de conta o pixelId antigo
  // sobrevive no estado — o SearchableSelect renderiza vazio (value fora das
  // options) mas o submit publicaria o ID da conta anterior (Meta 1815045 só na
  // fila, com campanha/conjunto já criados). Quando a lista da conta termina de
  // carregar sem o pixel selecionado, resetamos: o auto-select acima escolhe o
  // primeiro pixel da conta nova, ou o campo fica vazio e o submit trava.
  useEffect(() => {
    if (shouldResetOrphanPixel({
      pixelId,
      pixelIds: pixels.map(p => p.id),
      loading: pixelsRes.loading,
      error: pixelsRes.error,
    })) {
      setPixelId('');
    }
  }, [pixels, pixelsRes.loading, pixelsRes.error, pixelId]);
```

- [ ] **Step 3: Replace the presence-only validation**

Localizar (linhas ~2502-2504):

```ts
  // Pixel é obrigatório quando otimização é por conversão (vale tanto para non-DPA quanto DPA
  // com OFFSITE_CONVERSIONS — Meta precisa saber qual evento do pixel otimizar).
  if (!isEngagement && !pixelId) errors.push('Selecione um pixel.');
```

Substituir por:

```ts
  // Pixel é obrigatório quando otimização é por conversão (vale tanto para non-DPA quanto DPA
  // com OFFSITE_CONVERSIONS — Meta precisa saber qual evento do pixel otimizar) E precisa
  // pertencer à conta atual (trava de pixel, camada 1 — cinto e suspensório do reset acima).
  errors.push(...pixelSubmitErrors({ isEngagement, pixelId, pixelIds: pixels.map(p => p.id) }));
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 erros.

- [ ] **Step 5: Full test suite**

Run: `npx vitest run`
Expected: PASS, 0 falhas.

- [ ] **Step 6: Production build**

Run: `npm run build`
Expected: build conclui sem erros (warnings pré-existentes são aceitáveis).

- [ ] **Step 7: Commit**

```bash
git add app/campaigns/ClientCampaignBuilder.tsx
git commit -m "feat: builder reseta pixel órfão na troca de conta e valida pertencimento no submit"
```
