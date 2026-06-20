# Design — Sync de páginas por perfil (modelo standalone)

**Data:** 2026-06-20
**Status:** Aprovado (design), aguardando revisão do spec
**Área:** Tela "Páginas" do app REPORT — descoberta + limites de anúncios das Meta Pages

## Contexto

Hoje a tela **Páginas** tem dois fluxos globais:

- **"Buscar páginas"** (`kind: 'discovery'`) → `runDiscoveryChunk`: varre os BMs de **todos** os perfis (`me/accounts` ∪ `owned_pages` ∪ `client_pages` por BM) e faz upsert das páginas, sem limites de anúncios.
- **"Atualizar limites"** (`kind: 'refresh'`) → `runRefreshChunk`: varre **toda** a tabela `meta_ad_accounts` (todos os perfis) chamando `ads_volume` por conta.

Problemas observados:

1. O seletor de perfis do botão "Atualizar limites" **não escopa de fato** — `runRefreshChunk` ignora `job.profiles` e sempre percorre todas as contas. Por isso é lento e bate no rate limit `#4` (quota do app inteiro).
2. Existe um script standalone (`C:\Apps\Lista de páginas`) que, por **um token de perfil**, faz `me/accounts` + `me/adaccounts` + `ads_volume` por conta numa passada só, trazendo páginas **e** limites. É rápido porque é **escopado por token** (só as contas daquele perfil). Validado em produção com o perfil P251 (71 páginas, 177 contas).

## Objetivo

Substituir os dois fluxos globais por um **único sync por perfil**, escopado ao token de cada perfil, espelhando fielmente a lógica do script standalone. Mantém a infraestrutura de fila + scheduler já existente (resumível, sobrevive ao timeout de 300s do Firebase App Hosting).

## Decisões travadas (do brainstorming)

| Decisão | Escolha |
|---|---|
| Encaixe na UI | **Substituir** os dois botões globais por um único "Sincronizar perfis" |
| Modelo de execução | **Fila + Scheduler** (walk away), reaproveitando `page_sync_jobs` + `/api/cron/pages-sync` |
| Fonte de descoberta de páginas | **Só `me/accounts`** (fiel ao standalone; sem varredura de BMs) |
| Token salvo do P251 | **Não alterar** (pedido do usuário) — perfil aparecerá como "falhou" até renovar |

## A passada por perfil (fiel ao standalone)

Para o token de cada perfil selecionado:

1. **Páginas** — `GET /me/accounts?fields=id,name,instagram_business_account{id}` (paginado) → upsert em `meta_pages`:
   - `page_name` via `COALESCE(NULLIF(...))` (não apaga nome existente)
   - `accessible_profiles` unido com o nome do perfil (`ARRAY(SELECT DISTINCT unnest(... || ...))`)
   - `ig_account_id` via `COALESCE(EXCLUDED, atual)`
2. **Contas do perfil** — `GET /me/adaccounts?fields=id,account_id,name` (paginado, ao vivo) → lista de `act_…`.
3. **Limites** — para cada conta: `GET /act_…/ads_volume?show_breakdown_by_actor=true&fields=actor_id,actor_name,ads_running_or_in_review_count,limit_on_ads_running_or_in_review,current_account_ads_running_or_in_review_count&limit=50` → por página (`actor_id`): `ad_limit` = MAX(limite), `ads_running` = MAX(running).

### Guarda dos limites

O passo 3 grava com **UPDATE** (não insert):

```sql
UPDATE meta_pages
   SET ad_limit = $2, ads_running = $3, updated_at = now()
 WHERE page_id = $1 AND $perfil = ANY(accessible_profiles)
```

Assim só atualiza páginas que o perfil descobriu via `me/accounts` (passo 1) — idêntico ao standalone, que ignora `actor_id`s de `ads_volume` que não estão na lista de `me/accounts`. Páginas de contas compartilhadas mas não vistas em `me/accounts` não são tocadas/criadas.

## Execução: fila + scheduler, resumível

- Novo `kind: 'profile'` em `page_sync_jobs`. Um job carrega a lista de perfis (`profiles TEXT[]`, vazio/null = todos os configurados) e os processa **sequencialmente**.
- Nova coluna `state JSONB` em `page_sync_jobs` (DDL self-healing via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`), guardando o ponto de retomada:

```ts
interface ProfileSyncState {
  profileIndex: number;             // qual perfil em profiles[]
  phase: 'pages' | 'limits';        // fase atual desse perfil
  accounts: string[] | null;        // me/adaccounts cacheado do perfil atual (null até buscar)
  accountOffset: number;            // próxima conta a processar na fase 'limits'
  failed?: string[];                // perfis que falharam (ex.: token expirado)
}
```

### Lógica do worker (`runProfileSyncChunk`, chamado por `/api/cron/pages-sync`)

A cada tick (orçamento de tempo `REFRESH_TIME_BUDGET_MS` = 180s, dentro do canal de 1200s do cron):

1. Resolve `profiles` (filtrando os que têm token). Se `state.profileIndex >= profiles.length` → `done`.
2. `profile = profiles[state.profileIndex]`, `token = profile.token`.
3. Se `phase === 'pages'`:
   - Busca `me/accounts` → upsert das páginas (passo 1).
   - Busca `me/adaccounts` → `state.accounts`, `accountOffset = 0`, `phase = 'limits'`.
   - (ambos são rápidos; segue direto pra fase de limites no mesmo tick se houver orçamento.)
4. Se `phase === 'limits'`:
   - Processa `accounts[accountOffset ..]` em lotes, `ads_volume` por conta (passo 3 + guarda), respeitando o orçamento de tempo.
   - Avança `accountOffset`. Se chegou ao fim das contas → próximo perfil (`profileIndex++`, `phase = 'pages'`, `accounts = null`, `accountOffset = 0`).
5. Persiste `state` + `cursor` + progresso e libera o job pro próximo tick. Quando todos os perfis terminam → `completeJob`.

> `cursor` (coluna inteira existente) espelha `profileIndex` para compatibilidade/observabilidade; o estado fino vive em `state`.

### Rate limit `#4` (quota do app)

Mesma semântica de hoje: ao receber `AppRateLimitError` na fase de limites, salva parcial, **mantém** `state` (incl. `accountOffset`) e libera; retoma no próximo tick (~2 min). Mensagem de progresso sinaliza a pausa.

### Erros por perfil

Token inválido/expirado (`#190`) de um perfil → loga, adiciona o nome a `state.failed`, **pula pro próximo perfil** (não derruba o job). Mensagem final lista os perfis que falharam. (Relevante: o token salvo do P251 está desatualizado e vai falhar até ser renovado via `/api-config`.)

## Mudanças por arquivo

| Arquivo | Mudança |
|---|---|
| `lib/meta-pages.ts` | **Adiciona** `runProfileSyncChunk(...)`. **Aposenta** `runRefreshChunk` e `runDiscoveryChunk` (e helpers que ficarem mortos). **Reaproveita** `fetchAllPages`, `fetchGraphWithRetry`, `fetchAdsVolumePagedPaced`, `Pacer`, `AppRateLimitError`, constantes de fields. **Adiciona** fetch de `me/adaccounts`. |
| `lib/sync-jobs.ts` | `JobStatus`/tipos: `kind` aceita `'profile'`. `createPageSyncJob` aceita `kind: 'profile'`. `ensureJobTable` adiciona `state JSONB` (self-healing). Helper `advanceProfileState(id, {state, cursor, message, current, total})`. `PageSyncJob` ganha `state`. |
| `app/api/pages/sync/route.ts` | Sempre cria job `kind: 'profile'` (ignora `kind` no body); aceita `profiles?: string[]` (vazio/ausente = todos os configurados). Não enfileira mais `refresh`/`discovery`. |
| `app/api/cron/pages-sync/route.ts` | Roteia `kind === 'profile'` → `runProfileSyncChunk`. Remove os ramos `discovery`/`refresh` (não mais enfileirados). |
| `app/paginas/ClientStatusPaginas.tsx` | Remove "Buscar páginas" e o botão global "Atualizar limites". Deixa **um** "Sincronizar perfis" com o seletor multi-perfil existente (vazio = todos). Mantém polling + barra de progresso. Rótulo de progresso: `Perfil P251 (1/3) — Limites: 50/177 contas`. |

Confirmado por busca: `runRefreshChunk`/`runDiscoveryChunk` só são referenciados em `app/api/cron/pages-sync/route.ts`; nenhum teste do projeto os usa. Superfície isolada.

## Modelo de dados

`meta_pages` permanece (`page_id` PK, `page_name`, `ad_limit`, `ads_running`, `accessible_profiles TEXT[]`, `ig_account_id`, `updated_at`). Sem migração de schema além do `state JSONB` em `page_sync_jobs`.

## Testes

Teste unitário de `runProfileSyncChunk` com `fetch` mockado (vitest):

- Fase `pages`: upsert correto (nome COALESCE, união de `accessible_profiles`, `ig`).
- `me/adaccounts` cacheado em `state.accounts`; não refetcha ao retomar.
- Fase `limits`: fatiamento por `accountOffset`, retomada (persistência de `state`), MAX por página.
- Guarda: `ads_volume` de página não descoberta pelo perfil → 0 linhas afetadas.
- Iteração entre perfis (profileIndex avança; reset de `phase`/`accounts`/`accountOffset`).
- `#4` na fase de limites → parcial + estado preservado.
- Token `#190` → perfil entra em `state.failed`, segue pro próximo.

## Trade-offs assumidos

- **Cobertura de descoberta** cai pro conjunto `me/accounts` (sem varredura de BMs). Páginas vistas só via `client_pages`/`owned_pages` de um BM deixam de ser capturadas.
- **Latência de início** ~2 min (pickup do scheduler) — semântica "walk away".
- **Token salvo do P251** intocado; aparece como perfil que falhou até renovar.

## Fora de escopo

- Renovar/trocar tokens de perfis (feito em `/api-config`).
- Sync de contas de anúncio (`meta_ad_accounts`) — fluxo separado (account-sync).
- Mudanças no schema de `meta_pages`.
