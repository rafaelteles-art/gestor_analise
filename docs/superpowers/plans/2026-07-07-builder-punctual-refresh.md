# Refresh Pontual no Campaign Builder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Botão ↻ por dropdown no builder (`/campaigns`) que recarrega só aquela fonte (pixels, públicos, catálogos, product sets, páginas, BMs, contas) sem reload da página e sem perder o formulário.

**Architecture:** Um hook genérico `useRefreshable<T>` substitui os `useEffect` de fetch do `ClientCampaignBuilder.tsx`, com proteção latest-wins e `setData` para mutações locais. Páginas usam sync por perfil (job em fila + poll, lógica extraída para `lib/page-sync-client.ts` e reutilizada por `/paginas`). Contas usam `router.refresh()` (re-executa o server component preservando estado do cliente).

**Tech Stack:** Next.js App Router (client component), React 18 (`useTransition`), vitest, lucide-react (`RefreshCw`), Tailwind com tokens do DESIGN.md.

**Spec:** `docs/superpowers/specs/2026-07-07-builder-punctual-refresh-design.md`

## Global Constraints

- **Zero dependências novas** (sem @testing-library, sem SWR/React Query).
- **DESIGN.md:** nunca `rounded-xl`, `shadow-sm`, indigo/azul como accent; usar `text-console-muted`, `text-foreground`, `border-console-border`, `bg-console-surface`.
- **Nenhuma mudança em rotas de API nem no worker de fila.**
- **Seleções nunca são limpas por um refresh** (se o item selecionado sumir da lista, o valor fica).
- **Working tree tem mudanças NÃO relacionadas** (`lib/meta-product-catalogs.ts`, `lib/meta-catalog-items-batch.*`, `graphify-out/*`): NUNCA incluir esses arquivos nos commits — sempre `git add` com paths explícitos.
- Gates por task: `npx tsc --noEmit` (0 erros) e `npx vitest run` (suíte toda verde). Gate final: `npm run build`.
- Um hook `post-commit` roda `graphify` automaticamente — não precisa rodar `graphify update .` manualmente.
- Números de linha citados são da versão atual do arquivo e deslocam conforme as tasks anteriores são aplicadas — localizar pelos trechos de código, não pelo número.

---

### Task 1: `lib/page-sync-client.ts` (TDD)

Extrai a lógica enqueue+poll do sync de páginas (hoje embutida em `ClientStatusPaginas.tsx:151-203`) para um helper testável com `fetch`/`sleep` injetáveis.

**Files:**
- Create: `lib/page-sync-client.ts`
- Test: `lib/page-sync-client.test.ts` (co-locado, padrão de `lib/meta-pages-pacing.test.ts`)

**Interfaces:**
- Consumes: `POST /api/pages/sync` (body `{profiles?: string[]}` → `{job_id, status, kind}`), `GET /api/pages/sync/status?job_id=N` (→ `{status: 'pending'|'running'|'done'|'error', message?, current?, total?, partial?, error?}`). Rotas já existem — não alterar.
- Produces: `runPageSyncJob(opts): Promise<{ partial: boolean }>` e `interface PageSyncProgress` — usados nas Tasks 2 e 6.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// lib/page-sync-client.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runPageSyncJob } from './page-sync-client';

type Json = Record<string, unknown>;
function jsonRes(body: Json, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}
const noSleep = () => Promise.resolve();

describe('runPageSyncJob', () => {
  it('enfileira, faz poll até done e resolve com partial=false', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonRes({ job_id: 7 }))
      .mockResolvedValueOnce(jsonRes({ status: 'running', message: 'Perfil P1', current: 1, total: 3 }))
      .mockResolvedValueOnce(jsonRes({ status: 'done', partial: false }));
    const progress: unknown[] = [];
    const out = await runPageSyncJob({
      profiles: ['P1'],
      onProgress: (p) => progress.push(p),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });
    expect(out).toEqual({ partial: false });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/pages/sync');
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string)).toEqual({ profiles: ['P1'] });
    expect(fetchImpl.mock.calls[1][0]).toBe('/api/pages/sync/status?job_id=7');
    // onProgress dispara em todo tick de poll, inclusive no tick 'done' (paridade
    // com o comportamento atual do /paginas).
    expect(progress[0]).toEqual({ message: 'Perfil P1', current: 1, total: 3, indeterminate: false });
    expect(progress[1]).toEqual({ message: 'Processando…', current: 0, total: 0, indeterminate: true });
  });

  it('propaga partial=true e manda body {} sem profiles (= todos os perfis)', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonRes({ job_id: 1 }))
      .mockResolvedValueOnce(jsonRes({ status: 'done', partial: true }));
    const out = await runPageSyncJob({ fetchImpl: fetchImpl as unknown as typeof fetch, sleepImpl: noSleep });
    expect(out).toEqual({ partial: true });
    expect(JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string)).toEqual({});
  });

  it('lança quando o enqueue falha', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonRes({ error: 'sem token' }, false, 500));
    await expect(runPageSyncJob({ fetchImpl: fetchImpl as unknown as typeof fetch, sleepImpl: noSleep }))
      .rejects.toThrow('sem token');
  });

  it('lança quando o job termina em error', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonRes({ job_id: 2 }))
      .mockResolvedValueOnce(jsonRes({ status: 'error', error: 'rate limit' }));
    await expect(runPageSyncJob({ fetchImpl: fetchImpl as unknown as typeof fetch, sleepImpl: noSleep }))
      .rejects.toThrow('rate limit');
  });

  it('tolera falha transitória de rede no poll e continua', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonRes({ job_id: 3 }))
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(jsonRes({ status: 'done', partial: false }));
    const out = await runPageSyncJob({ fetchImpl: fetchImpl as unknown as typeof fetch, sleepImpl: noSleep });
    expect(out).toEqual({ partial: false });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/page-sync-client.test.ts`
Expected: FAIL — "Cannot find module './page-sync-client'" (ou equivalente).

- [ ] **Step 3: Implementar o helper**

```ts
// lib/page-sync-client.ts
/**
 * Client-side helper do sync de páginas por perfil: enfileira o job
 * (POST /api/pages/sync) e faz poll até terminar. O Cloud Scheduler pode levar
 * até ~2 min para pegar o job — o poll é paciente por design ("async, walk away").
 * fetch/sleep são injetáveis para teste.
 */
export interface PageSyncProgress {
  message: string;
  current: number;
  total: number;
  indeterminate: boolean;
}

export async function runPageSyncJob(opts: {
  profiles?: string[];
  onProgress?: (p: PageSyncProgress) => void;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  pollMs?: number;
} = {}): Promise<{ partial: boolean }> {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleepImpl ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollMs = opts.pollMs ?? 2500;

  const res = await doFetch('/api/pages/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts.profiles && opts.profiles.length ? { profiles: opts.profiles } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || !data.job_id) throw new Error(String(data.error ?? `HTTP ${res.status}`));
  const jobId = data.job_id as number;

  while (true) {
    await sleep(pollMs);
    let job: Record<string, unknown>;
    try {
      const st = await doFetch(`/api/pages/sync/status?job_id=${jobId}`);
      job = (await st.json()) as Record<string, unknown>;
      if (!st.ok) throw new Error(String(job.error ?? `HTTP ${st.status}`));
    } catch {
      continue; // transitório — segue tentando
    }
    opts.onProgress?.({
      message: typeof job.message === 'string' ? job.message : 'Processando…',
      current: typeof job.current === 'number' ? job.current : 0,
      total: typeof job.total === 'number' ? job.total : 0,
      indeterminate: !job.total,
    });
    if (job.status === 'done') return { partial: job.partial === true };
    if (job.status === 'error') throw new Error(typeof job.error === 'string' ? job.error : 'erro desconhecido');
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/page-sync-client.test.ts`
Expected: PASS — 5 testes verdes.

- [ ] **Step 5: Commit**

```bash
git add lib/page-sync-client.ts lib/page-sync-client.test.ts
git commit -m "feat: helper runPageSyncJob (enqueue+poll do sync de páginas, testável)"
```

---

### Task 2: `ClientStatusPaginas.tsx` consome o helper

Substitui o corpo de `runPolledSync` pelo helper, preservando comportamento (progresso, alert de partial, alert de erro, reload no final). Duas simplificações aceitas: (a) as mensagens de erro de "iniciar" e "rodar" se unificam em `Erro em {label}: …`; (b) o alert de partial usa texto fixo em vez de `job.message`.

**Files:**
- Modify: `app/app/paginas/ClientStatusPaginas.tsx:149-203` (função `runPolledSync`; manter `handleSync` intacto)

**Interfaces:**
- Consumes: `runPageSyncJob`, `PageSyncProgress` de `@/lib/page-sync-client` (Task 1).
- Produces: nada novo (refactor interno).

- [ ] **Step 1: Substituir `runPolledSync`**

Adicionar o import no topo do arquivo (junto dos imports existentes):

```ts
import { runPageSyncJob } from '@/lib/page-sync-client';
```

Remover a linha `const sleep = (ms: number) => ...` (linha ~149) e substituir a função `runPolledSync` inteira (linhas ~151-203) por:

```ts
  const runPolledSync = async (label: string, profiles?: string[]) => {
    setSyncProgress({ label, message: 'Enfileirando…', current: 0, total: 0, indeterminate: true });
    try {
      const { partial } = await runPageSyncJob({
        profiles,
        onProgress: (p) => setSyncProgress({ label, ...p }),
      });
      if (partial) {
        alert('Sincronização parcial: rate limit do app Facebook atingido. Tente novamente em ~1h.');
      }
      setTimeout(() => window.location.reload(), 400);
    } catch (err: unknown) {
      alert(`Erro em ${label}: ${err instanceof Error ? err.message : 'desconhecido'}`);
      setSyncProgress(null);
    }
  };
```

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc sem output (0 erros); suíte toda verde.

- [ ] **Step 3: Commit**

```bash
git add app/app/paginas/ClientStatusPaginas.tsx
git commit -m "refactor: /paginas usa runPageSyncJob (helper extraído)"
```

---

### Task 3: Hook `useRefreshable` + `fetchJson`

**Files:**
- Create: `app/app/campaigns/useRefreshable.ts`

**Interfaces:**
- Produces (usados nas Tasks 4-6):
  - `useRefreshable<T>(opts: { fetcher: () => Promise<T>; initial: T; deps: DependencyList; enabled?: boolean; auto?: boolean }): Refreshable<T>`
  - `interface Refreshable<T> { data: T; loading: boolean; error: string | null; refresh: () => Promise<T | null>; reset: () => void; setData: Dispatch<SetStateAction<T>> }`
  - `fetchJson<T>(url: string): Promise<T>` — lança `Error` em `!res.ok` ou payload com `error`.
- Sem teste unitário (decisão do spec: sem @testing-library; hook fino coberto por tsc + smoke).

- [ ] **Step 1: Criar o arquivo**

```ts
// app/app/campaigns/useRefreshable.ts
'use client';

import {
  useCallback, useEffect, useRef, useState,
  type DependencyList, type Dispatch, type SetStateAction,
} from 'react';

/**
 * Recurso recarregável do builder: auto-carrega quando `deps` mudam (com
 * `enabled`), e expõe `refresh()` para o botão ↻ recarregar só esta fonte sem
 * reload da página. Latest-wins: resposta de um load antigo que chegar
 * atrasada é descartada (contador de request).
 *
 * - `enabled: false` → reseta `data` para `initial` e não busca (semântica de
 *   product sets sem catálogo selecionado).
 * - `auto: false` → nunca auto-carrega; só via `refresh()` (caso das BMs).
 * - `initial` é capturado no primeiro render (mudanças posteriores são ignoradas).
 */
export interface Refreshable<T> {
  data: T;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<T | null>;
  reset: () => void;
  setData: Dispatch<SetStateAction<T>>;
}

export function useRefreshable<T>(opts: {
  fetcher: () => Promise<T>;
  initial: T;
  deps: DependencyList;
  enabled?: boolean;
  auto?: boolean;
}): Refreshable<T> {
  const { fetcher, deps, enabled = true, auto = true } = opts;
  const [data, setData] = useState<T>(opts.initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reqIdRef = useRef(0);
  const initialRef = useRef(opts.initial);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher; // sempre a closure mais recente; `deps` dirigem o auto-load
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const refresh = useCallback(async (): Promise<T | null> => {
    if (!enabledRef.current) return null;
    const id = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetcherRef.current();
      if (id !== reqIdRef.current) return null; // resposta velha: descarta
      setData(result);
      return result;
    } catch (e) {
      if (id !== reqIdRef.current) return null;
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      if (id === reqIdRef.current) setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    reqIdRef.current++; // invalida qualquer request em voo
    setData(initialRef.current);
    setLoading(false);
    setError(null);
  }, []);

  useEffect(() => {
    if (!enabled) { reset(); return; }
    if (!auto) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, auto]);

  return { data, loading, error, refresh, reset, setData };
}

/** fetch + json com contrato de erro das rotas do builder ({ error: string }). */
export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const data: unknown = await res.json().catch(() => ({}));
  const err = (data as { error?: unknown })?.error;
  if (!res.ok || err) throw new Error(typeof err === 'string' ? err : `HTTP ${res.status}`);
  return data as T;
}
```

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit`
Expected: sem output (0 erros).

- [ ] **Step 3: Commit**

```bash
git add app/app/campaigns/useRefreshable.ts
git commit -m "feat: hook useRefreshable (recursos recarregáveis do builder, latest-wins)"
```

---

### Task 4: Builder — pixels, públicos e catálogos via hook

Substitui o bloco de estado + `Promise.all` (linhas ~1354-1381) por três hooks independentes. **Aliases de leitura mantêm os nomes `pixels`/`audiences`/`catalogs`/`catalogSourceCounts`/`loadingDeps`** para o resto do arquivo (~4500 linhas) não mudar.

**Files:**
- Modify: `app/app/campaigns/ClientCampaignBuilder.tsx` (~1354-1381, ~1490, ~2820, ~3753)

**Interfaces:**
- Consumes: `useRefreshable`, `fetchJson` (Task 3).
- Produces (usados nas Tasks 5-7): `depsQs: string`, `pixelsRes: Refreshable<Pixel[]>`, `audiencesRes: Refreshable<{custom: Audience[]; saved: Audience[]}>`, `catalogsRes: Refreshable<{catalogs: Catalog[]; source_counts: {db:number; api:number; total:number} | null}>`.

- [ ] **Step 1: Import**

No topo (junto dos imports existentes):

```ts
import { useRefreshable, fetchJson } from './useRefreshable';
```

- [ ] **Step 2: Substituir o bloco de estado/efeito**

No bloco "Listas dependentes da conta" (linhas ~1354-1381), **remover exatamente estas declarações**:

```ts
  const [pixels, setPixels] = useState<Pixel[]>([]);
  const [audiences, setAudiences] = useState<{ custom: Audience[]; saved: Audience[] }>({ custom: [], saved: [] });
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  const [catalogSourceCounts, setCatalogSourceCounts] = useState<{ db: number; api: number; total: number } | null>(null);
  const [loadingDeps, setLoadingDeps] = useState(false);
  const [depsError, setDepsError] = useState<string | null>(null);
```

**MANTER** nesta task: `const [pages, setPages] = useState<Page[]>([]);` (migra na Task 6) e `const [catalogBmFilter, setCatalogBmFilter] = useState<string>('');` (não migra — é filtro de UI local, não recurso).

Remover também o `useEffect` do `Promise.all` (linhas ~1364-1381, o que começa no comentário "Pixels, audiences, catalogs — específicos da conta").

No lugar, inserir:

```ts
  // Listas dependentes da conta — cada uma é um recurso "refreshable": o ↻ na
  // UI recarrega só aquela fonte, sem reload e sem tocar no resto do formulário.
  const depsQs = `account_id=${encodeURIComponent(accountId)}${profileName ? `&profile_name=${encodeURIComponent(profileName)}` : ''}`;

  const pixelsRes = useRefreshable<Pixel[]>({
    fetcher: async () =>
      (await fetchJson<{ pixels?: Pixel[] }>(`/api/campaigns/pixels?${depsQs}`)).pixels ?? [],
    initial: [],
    deps: [accountId, profileName],
    enabled: !!accountId,
  });

  const audiencesRes = useRefreshable<{ custom: Audience[]; saved: Audience[] }>({
    fetcher: async () => {
      const au = await fetchJson<{ custom?: Audience[]; saved?: Audience[] }>(`/api/campaigns/audiences?${depsQs}`);
      return { custom: au.custom ?? [], saved: au.saved ?? [] };
    },
    initial: { custom: [], saved: [] },
    deps: [accountId, profileName],
    enabled: !!accountId,
  });

  const catalogsRes = useRefreshable<{
    catalogs: Catalog[];
    source_counts: { db: number; api: number; total: number } | null;
  }>({
    fetcher: async () => {
      const cat = await fetchJson<{
        catalogs?: Catalog[];
        source_counts?: { db: number; api: number; total: number };
      }>(`/api/campaigns/catalogs?${depsQs}`);
      return { catalogs: cat.catalogs ?? [], source_counts: cat.source_counts ?? null };
    },
    initial: { catalogs: [], source_counts: null },
    deps: [accountId, profileName],
    enabled: !!accountId,
  });

  // Aliases de leitura — mantêm os nomes usados pelo resto do arquivo.
  const pixels = pixelsRes.data;
  const audiences = audiencesRes.data;
  const catalogs = catalogsRes.data.catalogs;
  const catalogSourceCounts = catalogsRes.data.source_counts;
  const loadingDeps = pixelsRes.loading || audiencesRes.loading || catalogsRes.loading;
```

Nota: antes, erro de catálogos era engolido (`.catch(() => ({catalogs: []}))`); agora aparece em `catalogsRes.error` (exibido na Task 7). Melhoria intencional.

- [ ] **Step 3: Atualizar os setters remanescentes**

Em `handleCreateCatalog` (linha ~1490):

```ts
      setCatalogs(prev => [...prev, { id: cat.id, name: cat.name, product_count: 0 }]);
```
vira:
```ts
      catalogsRes.setData(prev => ({ ...prev, catalogs: [...prev.catalogs, { id: cat.id, name: cat.name, product_count: 0 }] }));
```

No `LookalikeBuilder` (linha ~3753):

```tsx
                  onCreated={(a) => setAudiences(prev => ({ ...prev, custom: [a, ...prev.custom] }))}
```
vira:
```tsx
                  onCreated={(a) => audiencesRes.setData(prev => ({ ...prev, custom: [a, ...prev.custom] }))}
```

No hint do nome da campanha (linha ~2820):

```tsx
            <Field label="Nome da Campanha *" hint={loadingDeps ? 'Carregando pixels/páginas/públicos/catálogos…' : depsError ?? undefined}>
```
vira:
```tsx
            <Field label="Nome da Campanha *" hint={loadingDeps ? 'Carregando pixels/públicos/catálogos…' : undefined}>
```

Além disso, o `useEffect` de pages (linha ~1386-1395) referencia `setDepsError` no `.catch` — trocar essa linha por um catch silencioso **temporário** (a Task 6 remove esse effect inteiro):

```ts
      .catch(() => { /* Task 6 substitui este effect pelo pagesRes */ })
```

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 0 erros; suíte verde. (tsc é o gate real aqui — pega qualquer referência esquecida a `setPixels`/`depsError` etc.)

- [ ] **Step 5: Commit**

```bash
git add app/app/campaigns/ClientCampaignBuilder.tsx
git commit -m "refactor: pixels/públicos/catálogos do builder via useRefreshable"
```

---

### Task 5: Builder — product sets e BMs via hook

**Files:**
- Modify: `app/app/campaigns/ClientCampaignBuilder.tsx` (~1423-1424, ~1430-1468, ~1603, ~1635-1644)

**Interfaces:**
- Consumes: `depsQs`, `useRefreshable`, `fetchJson` (Tasks 3-4).
- Produces (Task 7): `productSetsRes: Refreshable<ProductSet[]>`, `businessesRes`, e `loadBusinesses(): Promise<void>` (mesmo nome de hoje — call sites da UI em ~2925/~2991 não mudam).

- [ ] **Step 1: Product sets**

Remover (linhas ~1423-1424):

```ts
  const [productSets, setProductSets] = useState<ProductSet[]>([]);
  const [loadingProductSets, setLoadingProductSets] = useState(false);
```

e o `useEffect` de product sets (linhas ~1635-1644, o que começa com `if (!catalogId) { setProductSets([]); return; }`). No lugar das declarações removidas:

```ts
  const productSetsRes = useRefreshable<ProductSet[]>({
    fetcher: async () =>
      (await fetchJson<{ product_sets?: ProductSet[] }>(
        `/api/campaigns/product_sets?${depsQs}&catalog_id=${encodeURIComponent(catalogId)}`
      )).product_sets ?? [],
    initial: [],
    deps: [catalogId, accountId, profileName],
    enabled: !!catalogId,
  });
  const productSets = productSetsRes.data;
  const loadingProductSets = productSetsRes.loading;
```

**ATENÇÃO à ordem de declaração:** `catalogId` é declarado ~10 linhas acima (linha ~1414) — o hook deve ficar DEPOIS dele (posição atual das linhas 1423-1424 já satisfaz isso).

Em `handleCreateProduct` (linha ~1603):

```ts
      setProductSets(prev => [...prev, { id: info.product_set_id, name: info.retailer_id, product_count: 1 }]);
```
vira:
```ts
      productSetsRes.setData(prev => [...prev, { id: info.product_set_id, name: info.retailer_id, product_count: 1 }]);
```

- [ ] **Step 2: BMs (businesses)**

Remover (linhas ~1430-1433):

```ts
  const [businesses, setBusinesses] = useState<{ id: string; name: string }[]>([]);
  const [businessSourceCounts, setBusinessSourceCounts] = useState<{ api: number; db: number; total: number } | null>(null);
  const [loadingBusinesses, setLoadingBusinesses] = useState(false);
  const [businessesError, setBusinessesError] = useState<string | null>(null);
```

Substituir a função `loadBusinesses` (linhas ~1441-1461) e o `useEffect` de limpeza (linhas ~1464-1468) por:

```ts
  // BMs visíveis ao token — lazy (auto: false): só carrega quando o usuário
  // entra no modo "novo catálogo" ou clica o ↻. Evita hit desnecessário na Graph.
  const businessesRes = useRefreshable<{
    businesses: { id: string; name: string }[];
    source_counts: { api: number; db: number; total: number } | null;
  }>({
    fetcher: async () => {
      const data = await fetchJson<{
        businesses?: { id: string; name: string }[];
        source_counts?: { api: number; db: number; total: number };
      }>(`/api/campaigns/businesses?${depsQs}`);
      return { businesses: data.businesses ?? [], source_counts: data.source_counts ?? null };
    },
    initial: { businesses: [], source_counts: null },
    deps: [accountId, profileName],
    enabled: !!accountId,
    auto: false,
  });
  const businesses = businessesRes.data.businesses;
  const businessSourceCounts = businessesRes.data.source_counts;
  const loadingBusinesses = businessesRes.loading;
  const businessesError = businessesRes.error;

  const loadBusinesses = async () => {
    const d = await businessesRes.refresh();
    // Auto-seleciona a primeira BM pra reduzir cliques (se nada selecionado)
    if (d && d.businesses.length > 0) setNewCatalogBmId(prev => prev || d.businesses[0].id);
  };

  // Limpa lista de BMs ao trocar de conta/perfil — token muda → BMs mudam
  useEffect(() => {
    businessesRes.reset();
    setNewCatalogBmId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, profileName]);
```

**ATENÇÃO à ordem:** `newCatalogBmId` é declarado logo acima (linha ~1428) — manter o bloco novo depois dele. Os call sites de `loadBusinesses` na UI (linhas ~2925 e ~2991) não mudam.

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 0 erros; suíte verde.

- [ ] **Step 4: Commit**

```bash
git add app/app/campaigns/ClientCampaignBuilder.tsx
git commit -m "refactor: product sets e BMs do builder via useRefreshable"
```

---

### Task 6: Builder — páginas via hook + fluxo sync-then-refetch

**Files:**
- Modify: `app/app/campaigns/ClientCampaignBuilder.tsx` (~1356 `const [pages, setPages]`, ~1383-1395)

**Interfaces:**
- Consumes: `runPageSyncJob` (Task 1), `useRefreshable`/`fetchJson` (Task 3).
- Produces (Task 7): `pagesRes: Refreshable<Page[]>`, `handleRefreshPages(): Promise<void>`, `pagesSyncMsg: string | null`, `pagesSyncError: string | null`, `loadingPages: boolean` (mesmo nome de hoje — `ChipPicker` em ~3868 não muda).

- [ ] **Step 1: Import**

```ts
import { runPageSyncJob } from '@/lib/page-sync-client';
```

- [ ] **Step 2: Substituir estado + effect de páginas**

Remover a linha remanescente `const [pages, setPages] = useState<Page[]>([]);` (~1356) e o bloco (~1383-1395):

```ts
  // Páginas — escopo é o perfil (todos os BMs acessíveis). Não muda ao trocar
  // de conta dentro do mesmo perfil.
  const [loadingPages, setLoadingPages] = useState(false);
  useEffect(() => { ... }, [profileName]);
```

No lugar (mesma região, junto dos outros hooks da Task 4):

```ts
  // Páginas — escopo é o perfil (todos os BMs acessíveis); a rota serve só do
  // banco (meta_pages). O ↻ roda o sync do perfil na Meta antes de re-buscar.
  const pagesRes = useRefreshable<Page[]>({
    fetcher: async () =>
      (await fetchJson<{ pages?: Page[] }>(
        `/api/campaigns/pages?profile_name=${encodeURIComponent(profileName)}`
      )).pages ?? [],
    initial: [],
    deps: [profileName],
    enabled: !!profileName,
  });
  const pages = pagesRes.data;

  const [pagesSyncBusy, setPagesSyncBusy] = useState(false);
  const [pagesSyncMsg, setPagesSyncMsg] = useState<string | null>(null);
  const [pagesSyncError, setPagesSyncError] = useState<string | null>(null);
  const loadingPages = pagesRes.loading || pagesSyncBusy;

  // ↻ de páginas: sync do perfil (job em fila; Scheduler pode levar ~2 min pra
  // pegar) → re-busca do banco. Não bloqueia o formulário enquanto roda.
  const handleRefreshPages = async () => {
    if (!profileName || pagesSyncBusy) return;
    setPagesSyncBusy(true);
    setPagesSyncError(null);
    setPagesSyncMsg('Enfileirando sync do perfil…');
    try {
      const { partial } = await runPageSyncJob({
        profiles: [profileName],
        onProgress: (p) => setPagesSyncMsg(p.indeterminate ? p.message : `${p.message} (${p.current}/${p.total})`),
      });
      setPagesSyncMsg(partial ? 'Sync parcial (rate limit #4) — mostrando o que foi atualizado.' : null);
      await pagesRes.refresh();
    } catch (e) {
      setPagesSyncError(e instanceof Error ? e.message : String(e));
      setPagesSyncMsg(null);
    } finally {
      setPagesSyncBusy(false);
    }
  };
```

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 0 erros; suíte verde.

- [ ] **Step 4: Commit**

```bash
git add app/app/campaigns/ClientCampaignBuilder.tsx
git commit -m "feat: páginas do builder via useRefreshable + sync do perfil no ↻"
```

---

### Task 7: `RefreshButton` + `Field action/error` + colocar os ↻

**Files:**
- Modify: `app/app/campaigns/ClientCampaignBuilder.tsx` (Field ~400-408; placements ~3590, ~3658, ~3098, ~3115, ~3853)

**Interfaces:**
- Consumes: `pixelsRes`, `audiencesRes`, `catalogsRes`, `productSetsRes`, `pagesRes`, `handleRefreshPages`, `pagesSyncMsg`, `pagesSyncError`, `loadingPages` (Tasks 4-6); helper `cls` (linha ~328, já existe); `RefreshCw` (já importado).
- Produces (Task 8): componente `RefreshButton({ onClick, loading?, title? })` e props novas de `Field` (`action?: React.ReactNode`, `error?: string | null`).

- [ ] **Step 1: Estender `Field`**

Substituir (linhas ~400-408):

```tsx
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold text-console-muted">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-console-muted">{hint}</span>}
    </label>
  );
}
```

por:

```tsx
function Field({ label, children, hint, action, error }: {
  label: string; children: React.ReactNode; hint?: string;
  /** controle opcional alinhado à direita do label (ex.: RefreshButton) */
  action?: React.ReactNode;
  /** erro do recurso — substitui o hint enquanto presente */
  error?: string | null;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center justify-between gap-2 text-[11px] font-semibold text-console-muted">
        <span>{label}</span>
        {action}
      </span>
      {children}
      {error && <span className="text-[10px] text-rose-600 dark:text-rose-400">{error}</span>}
      {hint && !error && <span className="text-[10px] text-console-muted">{hint}</span>}
    </label>
  );
}
```

- [ ] **Step 2: Criar `RefreshButton`** (logo abaixo de `Field`)

```tsx
/** Botãozinho ↻: recarrega uma lista pontualmente, sem reload da página.
 *  preventDefault evita que o clique dispare a ativação do <label> pai. */
function RefreshButton({ onClick, loading, title }: {
  onClick: () => void; loading?: boolean; title?: string;
}) {
  return (
    <button
      type="button"
      title={title ?? 'Recarregar'}
      disabled={loading}
      onClick={(e) => { e.preventDefault(); if (!loading) onClick(); }}
      className="shrink-0 p-0.5 rounded text-console-muted hover:text-foreground disabled:opacity-50"
    >
      <RefreshCw className={cls('h-3 w-3', !!loading && 'animate-spin')} />
    </button>
  );
}
```

- [ ] **Step 3: Colocar os ↻ (5 pontos)**

**(a) Pixel** (linha ~3590):
```tsx
            <Field label="Pixel"
              action={<RefreshButton onClick={() => void pixelsRes.refresh()} loading={pixelsRes.loading} title="Recarregar pixels da conta" />}
              error={pixelsRes.error}>
```

**(b) Públicos** — Field "Usar um público salvo" (linha ~3658; um ↻ cobre salvos e personalizados, mesma rota):
```tsx
            <Field label="Usar um público salvo"
              action={<RefreshButton onClick={() => void audiencesRes.refresh()} loading={audiencesRes.loading} title="Recarregar públicos (salvos e personalizados)" />}
              error={audiencesRes.error}>
```

**(c) Catálogo** (linha ~3098):
```tsx
                    <Field label="Catálogo"
                      action={<RefreshButton onClick={() => void catalogsRes.refresh()} loading={catalogsRes.loading} title="Recarregar catálogos" />}
                      error={catalogsRes.error}>
```

**(d) Conjunto de Produtos (fallback)** (linha ~3115):
```tsx
                    <Field label="Conjunto de Produtos (fallback)" hint="Usado quando o criativo não define o próprio set."
                      action={<RefreshButton onClick={() => { if (catalogId) void productSetsRes.refresh(); }} loading={productSetsRes.loading} title="Recarregar conjuntos de produtos" />}
                      error={productSetsRes.error}>
```

**(e) Páginas** (linha ~3853) — o hint existente é preservado; progresso do sync entra na frente dele:
```tsx
          <Field label="Páginas do Facebook *"
            action={<RefreshButton onClick={() => void handleRefreshPages()} loading={loadingPages} title="Sincronizar páginas do perfil na Meta e recarregar" />}
            error={pagesSyncError ?? pagesRes.error}
            hint={pagesSyncMsg ?? (isEngagement
            ? "Engajamento promove UMA Página: selecione exatamente uma — ela é curtida e também é a identidade dos anúncios. Escopo: perfil (todas BMs)."
            : "Selecione 1 ou mais páginas. Os anúncios serão distribuídos em round-robin entre elas (ou conforme alocação manual abaixo). Escopo: perfil (todas BMs).")}>
```

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 0 erros; suíte verde.

- [ ] **Step 5: Commit**

```bash
git add app/app/campaigns/ClientCampaignBuilder.tsx
git commit -m "feat: botões ↻ por lista no builder (pixels, públicos, catálogos, sets, páginas)"
```

---

### Task 8: Contas — `router.refresh()` e sync sem reload

**Files:**
- Modify: `app/app/campaigns/ClientCampaignBuilder.tsx` (imports; `handleSyncAccounts` ~1297-1325; Field "Conta de Anúncio" ~2803; linha de status do sync ~2725)

**Interfaces:**
- Consumes: `RefreshButton` (Task 7).
- Produces: nada novo.

- [ ] **Step 1: Imports**

```ts
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
```
(a primeira linha substitui o import de react existente na linha 3.)

- [ ] **Step 2: Estado + handler** (junto do bloco "Sync de contas", ~1293)

```ts
  const router = useRouter();
  // ↻ de contas: re-executa o server component (page.tsx re-lê o banco) sem
  // perder o estado do formulário. Não faz scan na Meta — o cron horário e o
  // botão "Sincronizar contas" cobrem isso.
  const [accountsRefreshing, startAccountsRefresh] = useTransition();
  const handleRefreshAccounts = () => startAccountsRefresh(() => router.refresh());
```

- [ ] **Step 3: `handleSyncAccounts` sem reload**

Substituir (linhas ~1312-1314):

```ts
      if (last?.type === 'done' && last?.success) {
        setSyncMsg('Concluído — recarregando…');
        window.location.reload();
      }
```
por:
```ts
      if (last?.type === 'done' && last?.success) {
        setSyncMsg('Concluído — contas atualizadas.');
        startAccountsRefresh(() => router.refresh());
        setSyncing(false);
      }
```

E na exibição do status (linha ~2725), trocar:
```tsx
        {syncing && syncMsg && <p className="text-[11px] text-console-muted">{syncMsg}</p>}
```
por (a msg "Concluído" precisa aparecer com `syncing` já falso):
```tsx
        {syncMsg && <p className="text-[11px] text-console-muted">{syncMsg}</p>}
```

- [ ] **Step 4: ↻ na conta** (linha ~2803)

```tsx
            <Field label="Conta de Anúncio"
              action={<RefreshButton onClick={handleRefreshAccounts} loading={accountsRefreshing} title="Re-ler contas do banco (sem scan na Meta)" />}
              hint={isBroadcast ? `Modo broadcast: a campanha será criada em ${accountIds.length} contas sequencialmente.` : undefined}>
```

- [ ] **Step 5: Verificar**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 0 erros; suíte verde.

- [ ] **Step 6: Commit**

```bash
git add app/app/campaigns/ClientCampaignBuilder.tsx
git commit -m "feat: ↻ de contas via router.refresh; sync de contas sem reload da página"
```

---

### Task 9: Verificação final

- [ ] **Step 1: Gates completos**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc 0 erros; suíte toda verde (incl. os 5 testes novos); build sem erros.

- [ ] **Step 2: Smoke manual (dev)**

Run: `npm run dev` e abrir `/campaigns`. Verificar:
1. Preencher nome da campanha, clicar ↻ de pixels → lista recarrega, nome digitado permanece.
2. ↻ de páginas → texto "Enfileirando sync do perfil…" aparece ao lado do label; formulário continua utilizável; ao terminar, lista re-busca (pode levar ~2 min pelo Scheduler — comportamento esperado).
3. ↻ de contas → spinner breve, contas/apelidos atualizam, formulário intacto.
4. "Sincronizar contas" → ao concluir, "Concluído — contas atualizadas." e SEM reload da página.
5. Trocar de conta rapidamente 2× → pixels exibidos são da conta final (latest-wins).

- [ ] **Step 3: Commit final (se houver ajustes do smoke)**

```bash
git add app/app/campaigns/ClientCampaignBuilder.tsx app/app/campaigns/useRefreshable.ts lib/page-sync-client.ts
git commit -m "fix: ajustes do smoke-test do refresh pontual"
```
