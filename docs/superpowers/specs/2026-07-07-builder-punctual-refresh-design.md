# Refresh pontual no Campaign Builder (sem reload da página)

**Data:** 2026-07-07
**Status:** Aprovado

## Problema

No builder (`/campaigns`), mudanças feitas fora da página — pixel novo criado, página
concedida ao perfil, conta nova no BM, público/catálogo criado no Ads Manager — só
aparecem após F5, que descarta todo o formulário preenchido. O botão "Sincronizar
contas" existente termina em `window.location.reload()`, com a mesma perda.

## Solução

Botão ↻ por dropdown que recarrega **só aquela fonte**, preservando todo o estado do
formulário. Implementado via um hook genérico `useRefreshable` que substitui os
`useEffect` de fetch atuais.

### Fontes e comportamento do ↻

| Lista | Fonte da rota | Comportamento do ↻ |
|---|---|---|
| Pixels | Graph API ao vivo | re-fetch |
| Públicos (custom+saved) | Graph API ao vivo | re-fetch |
| Catálogos | mista (db+api) | re-fetch |
| Product sets | Graph API ao vivo | re-fetch |
| Páginas | **só banco** (`meta_pages`) | sync do perfil ativo (job em fila) → poll → re-fetch |
| BMs (novo catálogo) | Graph API ao vivo | re-fetch (já era lazy; vira `refresh()` do hook) |
| Contas do perfil | props do server component | `router.refresh()` em `useTransition` |

## Componentes

### 1. Hook `useRefreshable` — `app/app/campaigns/useRefreshable.ts`

```ts
interface Refreshable<T> {
  data: T;
  loading: boolean;
  error: string | null;      // mensagem do último load; refresh() re-tenta
  refresh: () => Promise<T | null>;  // resolve com o payload (null se pulado/erro/descartado)
  reset: () => void;                 // volta a `initial` e invalida requests em voo (BMs ao trocar de conta)
  setData: Dispatch<SetStateAction<T>>; // mutações locais (ex.: catálogo criado inline)
}

useRefreshable<T>(opts: {
  fetcher: () => Promise<T>;  // lança em erro
  initial: T;
  deps: DependencyList;       // auto-load quando mudam
  enabled?: boolean;          // default true; false = pula auto-load
  auto?: boolean;             // default true; false = nunca auto-carrega (BMs)
}): Refreshable<T>
```

- **Latest-wins:** contador interno de request; resposta atrasada de um load antigo é
  descartada. Conserta bug latente do código atual (troca rápida de conta podia deixar
  pixels/públicos da conta anterior).
- `deps` mudou + `enabled` → auto-load. `auto: false` = só via `refresh()`.
- Quando `enabled` vira falso, `data` reseta para `initial` (sem fetch). É a semântica
  atual de product sets (`if (!catalogId) setProductSets([])`) e é mais correta que
  manter dado stale para as demais listas (hoje pixels/páginas mantêm o dado antigo
  quando a dep esvazia — só acontece no caso degenerado de zero contas/perfis).

### 2. Wiring no `ClientCampaignBuilder.tsx`

O `Promise.all` de pixels/públicos/catálogos é desagrupado em três hooks independentes
(loading/erro granulares por lista):

| Hook | T | deps | enabled |
|---|---|---|---|
| pixels | `Pixel[]` | `[accountId, profileName]` | `!!accountId` |
| audiences | `{custom, saved}` | `[accountId, profileName]` | `!!accountId` |
| catalogs | `{catalogs, source_counts}` | `[accountId, profileName]` | `!!accountId` |
| productSets | `ProductSet[]` | `[catalogId, accountId, profileName]` | `!!catalogId` |
| pages | `Page[]` | `[profileName]` | `!!profileName` |
| businesses | `{businesses, source_counts}` | — | `auto: false` |

`handleCreateCatalog` passa a usar `catalogs.setData`. O auto-select da primeira BM
(`setNewCatalogBmId`) continua no caller, após `refresh()` das BMs.

### 3. Componente `RefreshButton`

Botão de ícone ↻ (props: `onClick`, `loading`, `title?`), gira e desabilita durante o
load, ao lado do label de cada dropdown. Segue `DESIGN.md`: `text-console-muted`, hover
`text-foreground`, sem `rounded-xl`/`shadow-sm`/indigo.

**Seleções nunca são limpas no refresh.** Se o item selecionado sumir da lista nova, o
valor permanece e o usuário troca manualmente.

### 4. Páginas — sync do perfil + poll

↻ de páginas roda: `POST /api/pages/sync {profiles: [perfilAtivo]}` → poll
`/api/pages/sync/status?job_id=…` a cada 2,5 s → `done` → `pages.refresh()`.

- Progresso em texto discreto ao lado do dropdown ("Sincronizando… 3/12").
- O poller do Scheduler pode levar até ~2 min para pegar o job; o usuário continua
  preenchendo o formulário enquanto isso (não bloqueia nada).
- `partial: true` (rate limit #4) → mostra o aviso no texto de progresso e ainda
  re-busca (dados parciais são melhores que nada).

**Extração:** a lógica enqueue+poll sai de `ClientStatusPaginas.tsx` para
`lib/page-sync-client.ts`:

```ts
runPageSyncJob(opts: {
  profiles?: string[];
  onProgress?: (p: {message: string; current: number; total: number; indeterminate: boolean}) => void;
  fetchImpl?: typeof fetch;   // injetável p/ teste
  sleepImpl?: (ms: number) => Promise<void>;
}): Promise<{ partial: boolean }>   // lança em erro
```

`ClientStatusPaginas` passa a consumir o helper — comportamento preservado (alerts e
`window.location.reload()` continuam lá, no caller).

### 5. Contas do perfil — `router.refresh()`

- ↻ ao lado do seletor de conta: `startTransition(() => router.refresh())`; spinner via
  `isPending`. Server component re-executa, props `accounts`/`profileNames` atualizam,
  estado do cliente sobrevive. O efeito de prune existente já descarta conta
  selecionada que saiu do perfil.
- **Bônus:** `handleSyncAccounts` troca `window.location.reload()` por
  `router.refresh()` — o sync manual de contas também deixa de perder o formulário.
- Não dispara scan na Meta (o cron horário + botão "Sincronizar contas" cobrem isso).

## Tratamento de erros

Cada hook expõe `error` próprio, exibido em texto vermelho pequeno junto ao controle
correspondente. O `depsError` compartilhado atual é substituído pelos erros por
recurso. ↻ funciona como retry.

## Testes

- `lib/page-sync-client.ts`: teste vitest com `fetchImpl`/`sleepImpl` injetados —
  happy path, job com `status: 'error'`, `partial: true`, falha transitória de rede
  durante poll (continua tentando).
- Hook `useRefreshable`: fica fino (~40 linhas); sem `@testing-library/react` no
  projeto (decisão: não adicionar dependência) → coberto por `tsc` + smoke manual.
- Verificação final: `tsc` 0 erros, suíte vitest completa, `next build`.

## Fora de escopo

- Nenhuma mudança em rotas de API, worker de fila, ou fluxo de criação de campanha.
- Nenhum refresh automático/polling em background das listas (só manual via ↻).
- Scan de contas na Meta a partir do ↻ (usa o dado do banco).
