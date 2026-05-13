# Meta Pages — Implementação atual e próximos passos

Documento de handoff para retomar a construção do feature "Páginas do
Meta" em outra sessão. Já foi implementada a **infraestrutura de
backend** (lib + rota de sync + tabela). Falta UI, navegação,
configuração do feature e (se desejado) cron job.

Lógica portada do projeto **`c:\Apps\Lista de páginas`**
(`execution/fetch_facebook_pages.py`), adaptada para Next.js +
Postgres + multi-perfil, espelhando o padrão de `meta-accounts.ts`.

---

## 1. O que já está implementado

### 1.1 `lib/meta-pages.ts`

Duas funções exportadas:

- **`fetchPagesWithAdLimits(token: string): Promise<PageWithAdLimit[]>`**
  Para **1 token**:
  1. `GET /me/accounts` → todas as páginas do perfil (paginado)
  2. `GET /me/adaccounts` → todas as ad accounts do perfil (paginado)
  3. Em paralelo, para cada ad account: `GET /{act_id}/ads_volume?show_breakdown_by_actor=true`
     com fields `actor_id,actor_name,ads_running_or_in_review_count,limit_on_ads_running_or_in_review,current_account_ads_running_or_in_review_count`
  4. Junta tudo em `{ page_id, page_name, ad_limit, ads_running }`,
     pegando **MAX** entre ocorrências da mesma página em múltiplas
     ad accounts (não soma — `ads_running_or_in_review_count` e
     `limit_on_ads_running_or_in_review` já são totais por página).

- **`fetchAndSyncMetaPages(onProgress?): Promise<{ success, count, pages }>`**
  Multi-perfil + persistência:
  1. Lê todos os perfis de `getMetaProfiles()` (mesmo helper usado em
     `meta-accounts.ts` — vem de `app_settings.META_PROFILES` com
     fallback pra `process.env`).
  2. Roda `fetchPagesWithAdLimits` para cada token.
  3. Deduplica por `page_id`:
     - `ad_limit` → MAX entre perfis
     - `ads_running` → MAX entre perfis
     - `accessible_profiles` → união dos nomes dos perfis que viram a página
  4. Upsert na tabela `meta_pages` (criada on-demand via
     `CREATE TABLE IF NOT EXISTS`).

API version usada: `v19.0` (consistência com o resto do projeto;
o Python usava `v22.0`).

### 1.2 `app/api/pages/sync/route.ts`

`GET /api/pages/sync` — retorna **streaming NDJSON**, mesmo formato
de `/api/accounts/sync`:

```
{"type":"start","phase":"pages","message":"Iniciando sincronização de páginas…"}
{"type":"progress","phase":"pages","message":"Perfil X: buscando páginas e limites…"}
{"type":"progress","phase":"pages","message":"Perfil X: 42 páginas encontradas"}
{"type":"progress","phase":"pages","message":"Salvando 80 páginas no banco…"}
{"type":"done","success":true,"message":"Sincronizado com sucesso. 80 páginas.","pages":80}
```

Em caso de erro fatal: `{"type":"error","success":false,"error":"…"}`.

Erros por perfil (token inválido, BM sem permissão, etc) **não**
quebram o sync — são logados como `progress` e o sync segue com os
outros perfis.

`maxDuration = 300` segundos (compatível com Vercel Pro).

### 1.3 Tabela `meta_pages`

Criada automaticamente na primeira chamada de `fetchAndSyncMetaPages`.
DDL:

```sql
CREATE TABLE IF NOT EXISTS meta_pages (
  page_id              TEXT PRIMARY KEY,
  page_name            TEXT NOT NULL,
  ad_limit             INTEGER,                       -- null quando Graph não retorna
  ads_running          INTEGER NOT NULL DEFAULT 0,
  accessible_profiles  TEXT[]  NOT NULL DEFAULT '{}',
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
)
```

Diferenças intencionais vs o Python original:

| Campo                  | Python (`execution/`) | REPORT (aqui)                          |
| ---------------------- | --------------------- | -------------------------------------- |
| `ad_limit` ausente     | string `"N/A"`        | `NULL` (INTEGER nullable)              |
| Persistência           | Google Sheets         | Postgres `meta_pages`                  |
| Multi-perfil           | 1 token via `.env`    | N perfis via `getMetaProfiles()`       |
| `accessible_profiles`  | —                     | `TEXT[]` (igual `meta_ad_accounts`)    |
| Ad accounts em paralelo| Serial                | `Promise.all`                          |
| `updated_at`           | —                     | `TIMESTAMPTZ DEFAULT now()`            |

### 1.4 Sem mudanças em arquivos existentes

Nada foi tocado em `meta-accounts.ts`, `config.ts`, `db.ts`, layout,
nav, etc. A nova feature é 100% aditiva.

---

## 2. O que **falta** implementar

### 2.1 Página UI de listagem (`/status-paginas` ou similar)

Sugestão de paralelo: a página `/status-contas` já lista
`meta_ad_accounts` com filtros, toggles e busca. Replicar o padrão
para `meta_pages`:

- Server component que faz `SELECT * FROM meta_pages ORDER BY page_name`.
- Client component pra tabela com colunas:
  `page_name | page_id | ad_limit | ads_running | accessible_profiles | updated_at`.
- Filtros úteis:
  - Páginas sem limite (`ad_limit IS NULL`)
  - Páginas próximas do limite (ex: `ads_running >= ad_limit * 0.8`)
  - Por perfil (`'X' = ANY(accessible_profiles)`)
- Botão "Sincronizar agora" que dá `fetch('/api/pages/sync')` e mostra
  progress (consumir o NDJSON como em `/status-contas`).

Arquivo provável: `app/app/status-paginas/page.tsx` (+ um client
component pra interatividade).

### 2.2 Entrada na navegação

Adicionar link no menu lateral/topo. Procurar onde estão os outros
links (`status-contas`, `campaigns`, etc.) — provavelmente em
`app/components/` ou no `layout.tsx`.

### 2.3 Endpoint de leitura (opcional)

Hoje a UI pode ler direto via server component. Se quiser endpoint
JSON pra consumo externo: `GET /api/pages` retornando todos os rows
de `meta_pages` (modelo: `app/api/accounts/route.ts`, se existir).

### 2.4 Cron de sincronização (opcional)

A pasta `app/app/api/cron/` já existe e contém crons rodando em
schedule. Adicionar uma entrada que chame `fetchAndSyncMetaPages`
diariamente. Decidir frequência:
- 1x/dia é suficiente — limites e quantidades de ads ativos não
  mudam rapidamente.
- A não ser que se queira monitorar a contagem ao vivo, aí 1x/hora.

### 2.5 Considerações pendentes

- **Páginas excluídas**: a sync atual não remove páginas que o token
  não enxerga mais. Se isso virar problema, considerar marcar
  `is_stale` ou deletar entradas não vistas na rodada atual.
- **Concorrência da Graph API**: hoje paraleliza `ads_volume` por
  ad account dentro de cada perfil. Se um perfil tiver centenas de
  ad accounts, pode bater rate limit. O código já degrada bem (loga
  warning e segue). Se virar problema, adicionar throttling com
  `p-limit` ou batches de 10 (igual `meta-bulk/route.ts` faz).
- **Token expirado**: hoje só loga warning. Se quiser visibilidade
  na UI, capturar `data.error.code in (190, 102)` em `fetchAllPages`
  e propagar como evento `progress` com flag `tokenExpired`.

---

## 3. Como testar o que já existe

1. Garantir que `META_PROFILES` está em `app_settings` (configurado
   via `/api-config`) — sem isso a função lança
   `META_PROFILES não configurado`.
2. Subir o dev server:
   ```
   cd app
   npm run dev
   ```
3. Em outra aba, disparar o sync:
   ```
   curl -N http://localhost:3000/api/pages/sync
   ```
   ou abrir a URL no navegador (vai fazer download do NDJSON).
4. Verificar a tabela:
   ```sql
   SELECT page_name, ad_limit, ads_running,
          accessible_profiles, updated_at
   FROM meta_pages
   ORDER BY ads_running DESC;
   ```

---

## 4. Arquivos relevantes

Novos:

- `app/lib/meta-pages.ts`
- `app/app/api/pages/sync/route.ts`

Referências (modelos a seguir para o resto):

- `app/lib/meta-accounts.ts` — padrão de sync multi-perfil
- `app/app/api/accounts/sync/route.ts` — padrão de rota com streaming
- `app/app/status-contas/page.tsx` — padrão de página de listagem
- `app/app/api/cron/*` — padrão de cron jobs

Origem da lógica:

- `c:\Apps\Lista de páginas\execution\fetch_facebook_pages.py`
- `c:\Apps\Lista de páginas\directives\sync_facebook_pages_to_sheets.md`
