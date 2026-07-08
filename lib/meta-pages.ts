import { pool } from './db';
import { getMetaProfiles } from './config';
import { Pacer } from './meta-pages-pacing';
import type { ProfileSyncState } from './sync-jobs';

/**
 * Ordered, de-duplicated list of tokens to try for an ad account, resolved from
 * its accessible_profiles against the live profile→token map. ads_volume is
 * account-scoped, so any one working token returns the same data; extra tokens
 * are fallbacks for auth failures.
 */
export function tokensForAccount(
  accessibleProfiles: string[],
  profileMap: Map<string, string>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of accessibleProfiles) {
    const tok = profileMap.get(name);
    if (tok && !seen.has(tok)) { seen.add(tok); out.push(tok); }
  }
  return out;
}

const API_VERSION = 'v19.0';

export const REFRESH_TIME_BUDGET_MS = 180_000; // stop a chunk after ~180s so it always fits the cron window

// Quantas chamadas ads_volume simultâneas dentro de um perfil. Contas de um
// perfil se espalham por dezenas de BMs, então o BUC (quota por BM) raramente
// é o mesmo entre as 6; o Pacer compartilhado freia o lote quando os headers
// de uso sobem.
export const ADS_VOLUME_CONCURRENCY = 6;

const PAGE_FIELDS = 'id,name,instagram_business_account{id}';

interface RawPage {
  id: string;
  name?: string;
  instagram_business_account?: { id?: string };
}

interface AdsVolumeRow {
  actor_id?: string;
  actor_name?: string;
  ads_running_or_in_review_count?: number;
  limit_on_ads_running_or_in_review?: number;
  current_account_ads_running_or_in_review_count?: number;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Dependências injetáveis do sync (fetch/relógio/sleep/DB/perfis). Default =
 * produção; os testes passam fakes para exercitar o state machine sem rede/DB.
 */
export interface SyncDeps {
  fetchImpl: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  db: {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
    connect: () => Promise<{
      query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
      release: () => void;
    }>;
  };
  getProfiles: () => Promise<{ name: string; token: string }[]>;
}

function defaultDeps(): SyncDeps {
  return {
    fetchImpl: fetch,
    now: () => Date.now(),
    sleep: realSleep,
    db: pool as unknown as SyncDeps['db'],
    getProfiles: getMetaProfiles,
  };
}

// Erros transitórios da Graph onde vale a pena retry com backoff.
//   1  → "Please reduce the amount of data" (resposta grande / sobrecarga)
//   2  → "Service temporarily unavailable"
//   17 → "User request limit reached" (rate limit por usuário) — só esse token
//   32 → "Page request limit reached"
//   613→ "Calls to this api have exceeded the rate limit"
//
// #4 ("Application request limit reached") NÃO entra aqui — é quota do APP
// inteiro no Facebook (compartilhada entre tokens) e tipicamente só reseta em
// ~1h. Retry de segundos só piora. Tratamos como fatal: aborta o sync com a
// parcial salva, ver `AppRateLimitError`.
const TRANSIENT_GRAPH_CODES = new Set([1, 2, 17, 32, 613]);

export class AppRateLimitError extends Error {
  constructor(message?: string) {
    super(message || 'Meta Graph API: app-level rate limit (#4) reached. Try again in ~1 hour.');
    this.name = 'AppRateLimitError';
  }
}

// Lê os 3 headers de throttling que a Meta retorna em TODA resposta da Graph.
// Cada um é JSON stringificado com call_count, total_cputime, total_time em %.
//   x-app-usage              → quota do APP inteiro (a do painel "Limitação de volume")
//   x-business-use-case-usage → BUC: por BM/business e por endpoint-uso
//   x-ad-account-usage       → por ad account (inclui ads_insights)
// Ref: https://developers.facebook.com/docs/graph-api/overview/rate-limiting/
type Usage = { call_count?: number; total_cputime?: number; total_time?: number };

function readUsageHeaders(res: Response): {
  app: Usage | null;
  buc: Record<string, Usage[]> | null;
  adAcc: Record<string, Usage[]> | null;
} {
  const safeParse = (v: string | null) => {
    if (!v) return null;
    try { return JSON.parse(v); } catch { return null; }
  };
  return {
    app: safeParse(res.headers.get('x-app-usage')),
    buc: safeParse(res.headers.get('x-business-use-case-usage')),
    adAcc: safeParse(res.headers.get('x-ad-account-usage')),
  };
}

// Maior porcentagem de qualquer métrica em x-app-usage.
function maxAppUsagePct(usage: Usage | null): number {
  if (!usage) return 0;
  return Math.max(
    Number(usage.call_count ?? 0),
    Number(usage.total_cputime ?? 0),
    Number(usage.total_time ?? 0)
  );
}

// Maior porcentagem em qualquer entrada de BUC ou ad-account-usage.
function maxNestedUsagePct(nested: Record<string, Usage[]> | null): number {
  if (!nested) return 0;
  let max = 0;
  for (const arr of Object.values(nested)) {
    if (!Array.isArray(arr)) continue;
    for (const u of arr) {
      max = Math.max(max, maxAppUsagePct(u));
    }
  }
  return max;
}

/**
 * GET um endpoint do Graph com retry/backoff em erros transitórios.
 * Retorna `{ data, error }` — `error` populado se desistimos.
 *
 * Trata #4 de forma adaptativa: a Meta retorna "#4 Application request limit
 * reached" tanto para limite real do app QUANTO para BUC/ad-account-limit. Se
 * `x-app-usage` mostra uso baixo, é provavelmente BUC — vale retry com backoff
 * longo. Só aborta com `AppRateLimitError` se a quota do app estiver mesmo alta.
 *
 * `deadlineMs`: nenhum sleep de backoff pode cruzar esse instante. Antes do
 * deadline existir, backoffs de 30–60s dentro de UMA chamada estouravam os
 * 300s do LB do App Hosting — o request morria e o chunk inteiro era refeito.
 * Agora: #4 sem tempo p/ backoff → AppRateLimitError (vira parcial + resume);
 * transitório sem tempo → desiste e devolve o erro.
 */
async function fetchGraphWithRetry(
  url: string,
  maxAttempts = 5,
  pacer?: Pacer,
  deps: Pick<SyncDeps, 'fetchImpl' | 'now' | 'sleep'> = defaultDeps(),
  deadlineMs?: number,
): Promise<{ data: any; error: any | null }> {
  const canSleep = (ms: number) => deadlineMs === undefined || deps.now() + ms <= deadlineMs;
  let attempt = 0;
  while (true) {
    attempt++;
    let res: Response | null = null;
    try {
      res = await deps.fetchImpl(url);
      if (pacer && res) pacer.record(res);
    } catch (networkErr) {
      const backoff = Math.min(1000 * 2 ** (attempt - 1), 8000);
      if (attempt >= maxAttempts || !canSleep(backoff)) {
        return { data: null, error: { code: 'NETWORK', message: String(networkErr) } };
      }
      await deps.sleep(backoff);
      continue;
    }

    let data: any;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (data?.error) {
      const code = Number(data.error.code);

      if (code === 4) {
        const usage = readUsageHeaders(res);
        const appPct = maxAppUsagePct(usage.app);
        const bucPct = maxNestedUsagePct(usage.buc);
        const adPct = maxNestedUsagePct(usage.adAcc);
        const summary = `app=${appPct}% buc=${bucPct}% adAcc=${adPct}%`;
        console.warn(`[meta-pages] #4 throttle — ${summary} | headers: ${JSON.stringify(usage)}`);

        // Se app-usage está ≥80%, é mesmo a quota global do app — fatal.
        if (appPct >= 80) {
          throw new AppRateLimitError(
            `${data.error.message} (app usage ${appPct}%) — aguarde ~1h.`
          );
        }

        // Senão é BUC/ad-account. Backoff longo (30–60s) e tenta de novo —
        // BUC tipicamente reseta mais rápido que limite de app.
        const backoff = 30000 + Math.floor(Math.random() * 30000);
        if (attempt < maxAttempts && canSleep(backoff)) {
          console.warn(
            `[meta-pages] #4 com app usage baixo (${appPct}%) — provavelmente BUC (buc=${bucPct}%, adAcc=${adPct}%). Aguardando ${Math.round(backoff / 1000)}s antes de tentar ${attempt + 1}/${maxAttempts}`
          );
          await deps.sleep(backoff);
          continue;
        }

        // Esgotou retries (ou o backoff não cabe no orçamento do chunk) com
        // app-usage baixo: BUC/ad-account ainda travado → parcial + resume.
        throw new AppRateLimitError(
          `${data.error.message} (${summary}) — limite por BM/ad account, não pelo app inteiro. Aguarde ~30min ou rode menos perfis.`
        );
      }

      if (TRANSIENT_GRAPH_CODES.has(code) && attempt < maxAttempts) {
        const backoff = Math.min(1000 * 2 ** (attempt - 1), 10000);
        if (!canSleep(backoff)) return { data: null, error: data.error };
        console.warn(`[meta-pages] Graph (${code}) tentativa ${attempt}/${maxAttempts} — aguardando ${backoff}ms`);
        await deps.sleep(backoff);
        continue;
      }
      return { data: null, error: data.error };
    }

    return { data, error: null };
  }
}

/**
 * Pagina um endpoint do Graph até esgotar, sinalizando se parou por erro de auth
 * (#190/#102 — token expirado/inválido). `#4` propaga como AppRateLimitError.
 */
async function fetchAllPagedChecked<T = any>(
  url: string,
  deps: Pick<SyncDeps, 'fetchImpl' | 'now' | 'sleep'>,
  deadlineMs?: number,
): Promise<{ items: T[]; authError: boolean }> {
  const items: T[] = [];
  let nextUrl: string | null = url;
  let authError = false;

  while (nextUrl) {
    const { data, error } = await fetchGraphWithRetry(nextUrl, 5, undefined, deps, deadlineMs);
    if (error) {
      const code = Number(error.code);
      if (code === 190 || code === 102) authError = true;
      console.warn(`[meta-pages] Graph error (${error.code}): ${error.message ?? '—'}`);
      break;
    }
    if (Array.isArray(data?.data)) items.push(...data.data);
    nextUrl = data?.paging?.next ?? null;
  }

  return { items, authError };
}

/**
 * Resolve a lista de perfis a sincronizar a partir dos perfis configurados.
 * `names` (case/space-insensitive) filtra; vazio/undefined = todos. Função pura
 * sobre a lista de entrada — testável sem DB.
 */
export function selectProfiles<T extends { name: string; token: string }>(
  all: T[],
  names?: string[],
): T[] {
  const withToken = all.filter((p) => p.token);
  const wanted = names?.map((n) => n.toLowerCase().trim()).filter(Boolean);
  if (!wanted || wanted.length === 0) return withToken;
  return withToken.filter((p) => wanted.includes(p.name.toLowerCase().trim()));
}

/**
 * Ordena perfis pelo nº de contas conhecido (ascendente; desconhecido = 0),
 * desempate estável por nome. Os perfis pequenos terminam em minutos e entregam
 * dados frescos cedo; os gigantes (p133 ≈ 600 contas) moem no fim sem segurar
 * os outros. Função pura — testável.
 */
export function orderProfilesBySize<T extends { name: string }>(
  profiles: T[],
  accountCounts: Map<string, number>,
): T[] {
  return [...profiles].sort((a, b) => {
    const ca = accountCounts.get(a.name) ?? 0;
    const cb = accountCounts.get(b.name) ?? 0;
    if (ca !== cb) return ca - cb;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Reordena `profiles` segundo uma ordem persistida (lista de nomes). Nomes fora
 * da ordem vão para o fim, na ordem atual. `state.profileIndex` indexa esta
 * lista — a ordem TEM que ser estável entre chunks do mesmo job, senão o resume
 * pularia/duplicaria perfis. Função pura — testável.
 */
export function applyPersistedOrder<T extends { name: string }>(
  profiles: T[],
  order: string[] | null | undefined,
): T[] {
  if (!order || order.length === 0) return profiles;
  const pos = new Map(order.map((name, i) => [name, i]));
  return [...profiles].sort((a, b) => {
    const ia = pos.get(a.name) ?? Number.MAX_SAFE_INTEGER;
    const ib = pos.get(b.name) ?? Number.MAX_SAFE_INTEGER;
    return ia - ib;
  });
}

/** Conta contas de anúncio por perfil a partir de meta_ad_accounts (heurística p/ ordenação). */
async function fetchAccountCounts(db: SyncDeps['db']): Promise<Map<string, number>> {
  try {
    const res = await db.query(
      `SELECT unnest(accessible_profiles) AS profile, count(*)::int AS n
         FROM meta_ad_accounts GROUP BY 1`,
    );
    return new Map(res.rows.map((r: any) => [String(r.profile), Number(r.n)]));
  } catch {
    return new Map(); // tabela ausente/erro → ordem original
  }
}

/**
 * Reduz linhas de ads_volume (breakdown por actor) a mapas page_id → MAX(limit)
 * e page_id → MAX(running). `ads_running_or_in_review_count` e
 * `limit_on_ads_running_or_in_review` já são totais por-Página → MAX, nunca soma
 * (a mesma página pode reaparecer em várias contas). Função pura — testável.
 */
export function foldAdsVolumeRows(
  rows: AdsVolumeRow[],
  into?: { limits: Map<string, number>; running: Map<string, number>; names: Map<string, string> },
): { limits: Map<string, number>; running: Map<string, number>; names: Map<string, string> } {
  const acc = into ?? { limits: new Map(), running: new Map(), names: new Map() };
  for (const row of rows) {
    const id = row.actor_id;
    if (!id) continue;
    if (row.actor_name) acc.names.set(id, row.actor_name);
    const running = row.ads_running_or_in_review_count;
    if (typeof running === 'number') acc.running.set(id, Math.max(acc.running.get(id) ?? 0, running));
    const limit = row.limit_on_ads_running_or_in_review;
    if (typeof limit === 'number') {
      const cur = acc.limits.get(id);
      if (cur === undefined || limit > cur) acc.limits.set(id, limit);
    }
  }
  return acc;
}

const ADS_VOLUME_FIELDS = [
  'actor_id', 'actor_name', 'ads_running_or_in_review_count',
  'limit_on_ads_running_or_in_review', 'current_account_ads_running_or_in_review_count',
].join(',');

async function ensureMetaPagesTable(db: SyncDeps['db']): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS meta_pages (
      page_id TEXT PRIMARY KEY, page_name TEXT NOT NULL, ad_limit INTEGER,
      ads_running INTEGER NOT NULL DEFAULT 0, accessible_profiles TEXT[] NOT NULL DEFAULT '{}',
      ig_account_id TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await db.query(`ALTER TABLE meta_pages ADD COLUMN IF NOT EXISTS ig_account_id TEXT`);
}

export interface ProfileSyncProgress {
  message: string;
  current?: number;
  total?: number;
  /** Snapshot do estado resumível — o worker persiste p/ não refazer trabalho se o chunk morrer. */
  state?: ProfileSyncState;
}

/**
 * Per-profile page sync, modelado no script standalone (`Lista de páginas`):
 * por token, `me/accounts` (páginas) + `me/adaccounts` (contas do perfil) +
 * `ads_volume` por conta (limites/ativos). Escopado por token → rápido.
 *
 * Resumível via `state` (qual perfil, fase, contas cacheadas, offset, ordem).
 * Processa QUANTOS perfis couberem no orçamento de tempo do chunk (antes: 1
 * perfil por chunk — cada perfil rápido desperdiçava um tick inteiro do cron).
 * A fase de limites roda em lotes de ADS_VOLUME_CONCURRENCY chamadas paralelas.
 * `#4` → parcial + retoma; token expirado (#190) → pula o perfil e registra em
 * `state.failed`.
 */
export async function runProfileSyncChunk(opts: {
  state: ProfileSyncState;
  profileNames?: string[];
  onProgress?: (p: ProfileSyncProgress) => void;
  deps?: Partial<SyncDeps>;
}): Promise<{ state: ProfileSyncState; total: number; done: boolean; partial: boolean }> {
  const deps: SyncDeps = { ...defaultDeps(), ...opts.deps };

  // Clone defensivo do estado (não mutamos o objeto do chamador).
  const st: ProfileSyncState = {
    profileIndex: opts.state.profileIndex ?? 0,
    phase: opts.state.phase ?? 'pages',
    accounts: opts.state.accounts ?? null,
    accountOffset: opts.state.accountOffset ?? 0,
    failed: Array.isArray(opts.state.failed) ? [...opts.state.failed] : [],
    order: Array.isArray(opts.state.order) ? [...opts.state.order] : null,
  };

  const report = (message: string, current?: number, total?: number) => {
    try {
      opts.onProgress?.({
        message, current, total,
        state: { ...st, accounts: st.accounts ? [...st.accounts] : null, failed: [...st.failed], order: st.order ? [...st.order] : null },
      });
    } catch {}
  };

  const all = await deps.getProfiles();
  let profiles = selectProfiles(all, opts.profileNames);

  // Ordem estável do job: decidida no 1º chunk (menores primeiro) e persistida
  // no state — chunks seguintes reaplicam a MESMA ordem (profileIndex indexa ela).
  // Job antigo já em andamento (state sem `order`, de antes do deploy): congela
  // a ordem de configuração vigente — reordenar mid-job faria profileIndex
  // apontar para outro perfil e aplicaria contas cacheadas ao token errado.
  if (!st.order) {
    const isFreshJob = st.profileIndex === 0 && st.phase === 'pages' && !st.accounts && st.accountOffset === 0;
    if (isFreshJob) profiles = orderProfilesBySize(profiles, await fetchAccountCounts(deps.db));
    st.order = profiles.map((p) => p.name);
  } else {
    profiles = applyPersistedOrder(profiles, st.order);
  }
  const total = profiles.length;

  if (total === 0 || st.profileIndex >= total) {
    return { state: { ...st, profileIndex: total }, total, done: true, partial: false };
  }

  await ensureMetaPagesTable(deps.db);

  const startMs = deps.now();
  const deadlineMs = startMs + REFRESH_TIME_BUDGET_MS;
  let partial = false;

  const advanceToNextProfile = () => {
    st.profileIndex += 1;
    st.phase = 'pages';
    st.accounts = null;
    st.accountOffset = 0;
  };

  // ─── Loop de perfis: processa enquanto couber no orçamento do chunk ───
  while (st.profileIndex < total && !partial) {
    if (deps.now() - startMs > REFRESH_TIME_BUDGET_MS) break;

    const profile = profiles[st.profileIndex];
    const token = profile.token;
    const pacer = new Pacer();

    // ─── Fase 1: páginas (me/accounts) + lista de contas (me/adaccounts) ───
    if (st.phase === 'pages') {
      report(`Perfil ${profile.name} (${st.profileIndex + 1}/${total}) — buscando páginas`, st.profileIndex, total);

      let pages: RawPage[];
      let authError: boolean;
      try {
        ({ items: pages, authError } = await fetchAllPagedChecked<RawPage>(
          `https://graph.facebook.com/${API_VERSION}/me/accounts?fields=${PAGE_FIELDS}&limit=200&access_token=${token}`,
          deps, deadlineMs,
        ));
      } catch (err: any) {
        // #4 na fase de páginas: antes matava o job inteiro; agora vira parcial
        // e o próximo tick retoma este mesmo perfil/fase.
        if (err instanceof AppRateLimitError) { partial = true; break; }
        throw err;
      }

      if (authError) {
        if (!st.failed.includes(profile.name)) st.failed.push(profile.name);
        report(`Perfil ${profile.name}: token inválido/expirado — pulando`, st.profileIndex, total);
        advanceToNextProfile();
        continue;
      }

      if (pages.length > 0) {
        const client = await deps.db.connect();
        try {
          await client.query('BEGIN');
          for (const p of pages) {
            if (!p.id) continue;
            const ig = p.instagram_business_account?.id ?? null;
            await client.query(
              `INSERT INTO meta_pages (page_id, page_name, accessible_profiles, ig_account_id, updated_at)
               VALUES ($1, $2, ARRAY[$3]::text[], $4, now())
               ON CONFLICT (page_id) DO UPDATE SET
                 page_name = COALESCE(NULLIF(EXCLUDED.page_name, ''), meta_pages.page_name),
                 accessible_profiles = ARRAY(SELECT DISTINCT unnest(meta_pages.accessible_profiles || EXCLUDED.accessible_profiles)),
                 ig_account_id = COALESCE(EXCLUDED.ig_account_id, meta_pages.ig_account_id),
                 updated_at = now()`,
              [p.id, p.name ?? p.id, profile.name, ig],
            );
          }
          await client.query('COMMIT');
        } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
      }

      // Lista de contas do perfil (ao vivo). `id` já vem como "act_XXXX".
      let accs: { id: string }[];
      try {
        ({ items: accs } = await fetchAllPagedChecked<{ id: string }>(
          `https://graph.facebook.com/${API_VERSION}/me/adaccounts?fields=id,account_id,name&limit=200&access_token=${token}`,
          deps, deadlineMs,
        ));
      } catch (err: any) {
        if (err instanceof AppRateLimitError) { partial = true; break; }
        throw err;
      }
      st.accounts = accs.map((a) => a.id).filter(Boolean);
      st.accountOffset = 0;
      st.phase = 'limits';
      report(`Perfil ${profile.name} (${st.profileIndex + 1}/${total}) — ${pages.length} páginas, ${st.accounts.length} contas`, st.profileIndex, total);
    }

    // ─── Fase 2: limites (ads_volume) — lotes paralelos, fatiada pelo orçamento ───
    if (st.phase === 'limits') {
      const accounts = st.accounts ?? [];
      const folded = { limits: new Map<string, number>(), running: new Map<string, number>(), names: new Map<string, string>() };
      let stoppedEarly = false;

      while (st.accountOffset < accounts.length) {
        if (deps.now() - startMs > REFRESH_TIME_BUDGET_MS) { stoppedEarly = true; break; }
        const batch = accounts.slice(st.accountOffset, st.accountOffset + ADS_VOLUME_CONCURRENCY);
        const results = await Promise.all(batch.map(async (acc) => {
          const url = `https://graph.facebook.com/${API_VERSION}/${acc}/ads_volume` +
            `?show_breakdown_by_actor=true&fields=${ADS_VOLUME_FIELDS}&limit=50&access_token=${token}`;
          try {
            return await fetchAdsVolumePagedPaced<AdsVolumeRow>(url, pacer, deps, deadlineMs);
          } catch (err: any) {
            if (err instanceof AppRateLimitError) return err;
            throw err;
          }
        }));

        let hitAppLimit = false;
        for (const r of results) {
          if (r instanceof AppRateLimitError) { hitAppLimit = true; continue; }
          foldAdsVolumeRows(r.rows, folded);
        }
        if (hitAppLimit) {
          // Offset fica no início do lote: o próximo tick refaz só este lote
          // (fold/upsert são idempotentes — MAX por página).
          partial = true; stoppedEarly = true; break;
        }

        st.accountOffset += batch.length;
        report(`Perfil ${profile.name} (${st.profileIndex + 1}/${total}) — Limites: ${st.accountOffset}/${accounts.length} contas`, st.profileIndex, total);
        await deps.sleep(pacer.delayMs());
      }

      // Upsert dos limites coletados. UPDATE guardado pela posse do perfil: só
      // toca páginas que ESTE perfil descobriu via me/accounts (igual ao standalone,
      // que ignora actors fora da lista de páginas).
      const ids = new Set<string>([...folded.limits.keys(), ...folded.running.keys()]);
      if (ids.size > 0) {
        const client = await deps.db.connect();
        try {
          await client.query('BEGIN');
          for (const id of ids) {
            await client.query(
              `UPDATE meta_pages SET
                 ad_limit = COALESCE($2, ad_limit),
                 ads_running = $3,
                 updated_at = now()
               WHERE page_id = $1 AND $4 = ANY(accessible_profiles)`,
              [id, folded.limits.get(id) ?? null, folded.running.get(id) ?? 0, profile.name],
            );
          }
          await client.query('COMMIT');
        } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
      }

      if (stoppedEarly) break;

      if (st.accountOffset >= accounts.length) {
        report(`Perfil ${profile.name} (${st.profileIndex + 1}/${total}) — concluído`, st.profileIndex, total);
        advanceToNextProfile();
      }
    }
  }

  const done = !partial && st.profileIndex >= total;
  return { state: st, total, done, partial };
}

async function fetchAdsVolumePagedPaced<T = any>(
  initialUrl: string,
  pacer: Pacer,
  deps: Pick<SyncDeps, 'fetchImpl' | 'now' | 'sleep'>,
  deadlineMs?: number,
): Promise<{ rows: T[]; ok: boolean }> {
  const results: T[] = [];
  let nextUrl: string | null = initialUrl;
  while (nextUrl) {
    const { data, error } = await fetchGraphWithRetry(nextUrl, 4, pacer, deps, deadlineMs);
    if (error) {
      const code = Number(error.code);
      if (code === 1) {
        const u: URL = new URL(nextUrl);
        const cur = Number(u.searchParams.get('limit') ?? '50');
        const next = Math.max(5, Math.floor(cur / 2));
        if (next < cur) { u.searchParams.set('limit', String(next)); nextUrl = u.toString(); continue; }
      }
      console.warn(`[meta-pages] ads_volume error (${error.code}): ${error.message ?? '—'}`);
      return { rows: results, ok: false };
    }
    if (Array.isArray(data?.data)) results.push(...data.data);
    nextUrl = data?.paging?.next ?? null;
  }
  return { rows: results, ok: true };
}
