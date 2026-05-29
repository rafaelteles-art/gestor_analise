import { pool } from './db';
import { getMetaProfiles } from './config';
import { Pacer } from './meta-pages-pacing';

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

export const REFRESH_BATCH = 100;
export const REFRESH_TIME_BUDGET_MS = 180_000; // stop a chunk after ~180s so it always fits the cron window

const PAGE_FIELDS = 'id,name,instagram_business_account{id}';

interface RawPage {
  id: string;
  name?: string;
  instagram_business_account?: { id?: string };
}

interface RawBM {
  id: string;
  name?: string;
}

interface AdsVolumeRow {
  actor_id?: string;
  actor_name?: string;
  ads_running_or_in_review_count?: number;
  limit_on_ads_running_or_in_review?: number;
  current_account_ads_running_or_in_review_count?: number;
}

interface DbAdAccount {
  account_id: string;          // "act_XXXXX"
  accessible_profiles: string[];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
 */
async function fetchGraphWithRetry(
  url: string,
  maxAttempts = 5,
  pacer?: Pacer,
): Promise<{ data: any; error: any | null }> {
  let attempt = 0;
  while (true) {
    attempt++;
    let res: Response | null = null;
    try {
      res = await fetch(url);
      if (pacer && res) pacer.record(res);
    } catch (networkErr) {
      if (attempt >= maxAttempts) {
        return { data: null, error: { code: 'NETWORK', message: String(networkErr) } };
      }
      await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
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
        if (attempt < maxAttempts) {
          const backoff = 30000 + Math.floor(Math.random() * 30000);
          console.warn(
            `[meta-pages] #4 com app usage baixo (${appPct}%) — provavelmente BUC (buc=${bucPct}%, adAcc=${adPct}%). Aguardando ${Math.round(backoff / 1000)}s antes de tentar ${attempt + 1}/${maxAttempts}`
          );
          await sleep(backoff);
          continue;
        }

        // Esgotou retries com app-usage baixo: BUC/ad-account ainda travado.
        throw new AppRateLimitError(
          `${data.error.message} (${summary}) — limite por BM/ad account, não pelo app inteiro. Aguarde ~30min ou rode menos perfis.`
        );
      }

      if (TRANSIENT_GRAPH_CODES.has(code) && attempt < maxAttempts) {
        const backoff = Math.min(1000 * 2 ** (attempt - 1), 10000);
        console.warn(`[meta-pages] Graph (${code}) tentativa ${attempt}/${maxAttempts} — aguardando ${backoff}ms`);
        await sleep(backoff);
        continue;
      }
      return { data: null, error: data.error };
    }

    return { data, error: null };
  }
}

// Pagina um endpoint do Graph até esgotar.
// Em erro persistente (após retries), retorna o que coletou.
async function fetchAllPages<T = any>(url: string): Promise<T[]> {
  const results: T[] = [];
  let nextUrl: string | null = url;

  while (nextUrl) {
    const { data, error } = await fetchGraphWithRetry(nextUrl);

    if (error) {
      console.warn(`[meta-pages] Graph error (${error.code}): ${error.message ?? '—'}`);
      break;
    }

    if (Array.isArray(data?.data)) results.push(...data.data);
    nextUrl = data?.paging?.next ?? null;
  }

  return results;
}

// Descobre todos os BMs visíveis ao token: diretos (me/businesses) + sub-BMs
// (owned_businesses de cada BM direto). Mesmo padrão de meta-accounts.ts.
async function listAllBMs(token: string): Promise<RawBM[]> {
  const direct = await fetchAllPages<RawBM>(
    `https://graph.facebook.com/${API_VERSION}/me/businesses?fields=id,name&limit=200&access_token=${token}`
  );

  const all = new Map<string, RawBM>();
  for (const bm of direct) all.set(bm.id, bm);

  for (const bm of direct) {
    const owned = await fetchAllPages<RawBM>(
      `https://graph.facebook.com/${API_VERSION}/${bm.id}/owned_businesses?fields=id,name&limit=200&access_token=${token}`
    );
    for (const ob of owned) {
      if (!all.has(ob.id)) all.set(ob.id, ob);
    }
  }

  return Array.from(all.values());
}

/**
 * Discover all Pages a single Profile's token can see: me/accounts (personal)
 * ∪ owned_pages ∪ client_pages across every BM (direct + sub-BMs). System User
 * tokens return nothing on me/accounts, so the BM walk does the real work.
 * No ads_volume here — limits are filled later from the deduped account list.
 */
export async function discoverPagesForProfile(
  token: string,
  pacer?: Pacer,
  onProgress?: (msg: string) => void,
): Promise<RawPage[]> {
  const report = (m: string) => { try { onProgress?.(m); } catch {} };
  const out: RawPage[] = [];

  const personal = await fetchAllPages<RawPage>(
    `https://graph.facebook.com/${API_VERSION}/me/accounts?fields=${PAGE_FIELDS}&limit=200&access_token=${token}`,
  );
  out.push(...personal);

  const bms = await listAllBMs(token);
  for (let i = 0; i < bms.length; i++) {
    const bm = bms[i];
    report(`Páginas: BM ${i + 1}/${bms.length}`);
    const owned = await fetchAllPages<RawPage>(
      `https://graph.facebook.com/${API_VERSION}/${bm.id}/owned_pages?fields=${PAGE_FIELDS}&limit=200&access_token=${token}`,
    );
    const client = await fetchAllPages<RawPage>(
      `https://graph.facebook.com/${API_VERSION}/${bm.id}/client_pages?fields=${PAGE_FIELDS}&limit=200&access_token=${token}`,
    );
    out.push(...owned, ...client);
    if (pacer && i < bms.length - 1) await sleep(pacer.delayMs());
  }
  return out;
}

/**
 * Refresh ad_limit/ads_running for ONE batch of distinct ad accounts (account-scoped
 * ads_volume), upserting affected pages immediately. Resumable via offset. No BM walk.
 * ad_limit/ads_running are per-Page totals → MAX, never summed.
 */
export async function runRefreshChunk(opts: {
  offset: number;
  batchSize?: number;
  onProgress?: (p: { message: string; current?: number; total?: number }) => void;
}): Promise<{ processed: number; total: number; nextOffset: number; done: boolean; partial: boolean }> {
  const report = (message: string, current?: number, total?: number) => {
    try { opts.onProgress?.({ message, current, total }); } catch {}
  };
  const batchSize = opts.batchSize ?? REFRESH_BATCH;

  const profiles = (await getMetaProfiles()).filter((p) => p.token);
  const profileMap = new Map(profiles.map((p) => [p.name, p.token]));
  const pacer = new Pacer();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS meta_pages (
      page_id TEXT PRIMARY KEY, page_name TEXT NOT NULL, ad_limit INTEGER,
      ads_running INTEGER NOT NULL DEFAULT 0, accessible_profiles TEXT[] NOT NULL DEFAULT '{}',
      ig_account_id TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(`ALTER TABLE meta_pages ADD COLUMN IF NOT EXISTS ig_account_id TEXT`);

  const totalRes = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM meta_ad_accounts`);
  const total = totalRes.rows[0]?.n ?? 0;

  const accRes = await pool.query<DbAdAccount>(
    `SELECT account_id, COALESCE(accessible_profiles, '{}') AS accessible_profiles
       FROM meta_ad_accounts ORDER BY account_id ASC OFFSET $1 LIMIT $2`,
    [opts.offset, batchSize],
  );
  const accounts = accRes.rows;

  const fields = [
    'actor_id', 'actor_name', 'ads_running_or_in_review_count',
    'limit_on_ads_running_or_in_review', 'current_account_ads_running_or_in_review_count',
  ].join(',');

  const pageName = new Map<string, string>();
  const pageLimit = new Map<string, number>();
  const pageRunning = new Map<string, number>();
  const startMs = Date.now();
  let stoppedEarly = false;
  let partial = false;
  let processed = 0;

  for (const acc of accounts) {
    if (Date.now() - startMs > REFRESH_TIME_BUDGET_MS) { stoppedEarly = true; break; }
    const tokens = tokensForAccount(acc.accessible_profiles, profileMap);
    if (tokens.length === 0) { processed++; continue; }
    let rows: AdsVolumeRow[] = [];
    try {
      for (const token of tokens) {
        const url = `https://graph.facebook.com/${API_VERSION}/${acc.account_id}/ads_volume` +
          `?show_breakdown_by_actor=true&fields=${fields}&limit=50&access_token=${token}`;
        const r = await fetchAdsVolumePagedPaced<AdsVolumeRow>(url, pacer);
        rows = r.rows;
        if (r.ok) break;
      }
    } catch (err: any) {
      if (err instanceof AppRateLimitError) { partial = true; stoppedEarly = true; break; }
      throw err;
    }
    for (const row of rows) {
      const id = row.actor_id;
      if (!id) continue;
      if (row.actor_name) pageName.set(id, row.actor_name);
      const running = row.ads_running_or_in_review_count;
      if (typeof running === 'number') pageRunning.set(id, Math.max(pageRunning.get(id) ?? 0, running));
      const limit = row.limit_on_ads_running_or_in_review;
      if (typeof limit === 'number') {
        const cur = pageLimit.get(id);
        if (cur === undefined || limit > cur) pageLimit.set(id, limit);
      }
    }
    processed++;
    if (processed % 10 === 0) report(`Limites: ${opts.offset + processed}/${total} contas`, opts.offset + processed, total);
    await sleep(pacer.delayMs());
  }

  const ids = new Set<string>([...pageName.keys(), ...pageLimit.keys(), ...pageRunning.keys()]);
  if (ids.size > 0) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const id of ids) {
        await client.query(
          `INSERT INTO meta_pages (page_id, page_name, ad_limit, ads_running, updated_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (page_id) DO UPDATE SET
             ad_limit = EXCLUDED.ad_limit,
             ads_running = EXCLUDED.ads_running,
             page_name = COALESCE(NULLIF(meta_pages.page_name, ''), EXCLUDED.page_name),
             updated_at = now()`,
          [id, pageName.get(id) ?? id, pageLimit.get(id) ?? null, pageRunning.get(id) ?? 0],
        );
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }

  const nextOffset = opts.offset + processed;
  const done = !stoppedEarly && (opts.offset + accounts.length >= total);
  report(`Limites: ${Math.min(nextOffset, total)}/${total} contas`, Math.min(nextOffset, total), total);
  return { processed, total, nextOffset, done, partial };
}

/**
 * Discover pages for ONE profile (by index) and upsert them immediately, unioning
 * accessible_profiles. Resumable per profile. ig preferred non-null; additive only.
 */
export async function runDiscoveryChunk(opts: {
  profileIndex: number;
  profileNames?: string[];
  onProgress?: (p: { message: string; current?: number; total?: number }) => void;
}): Promise<{ total: number; nextIndex: number; done: boolean }> {
  const report = (message: string, current?: number, total?: number) => {
    try { opts.onProgress?.({ message, current, total }); } catch {}
  };
  const all = (await getMetaProfiles()).filter((p) => p.token);
  const wanted = opts.profileNames?.map((n) => n.toLowerCase().trim());
  const profiles = wanted && wanted.length ? all.filter((p) => wanted.includes(p.name.toLowerCase().trim())) : all;
  const total = profiles.length;
  if (opts.profileIndex >= total) return { total, nextIndex: opts.profileIndex, done: true };

  await pool.query(`
    CREATE TABLE IF NOT EXISTS meta_pages (
      page_id TEXT PRIMARY KEY, page_name TEXT NOT NULL, ad_limit INTEGER,
      ads_running INTEGER NOT NULL DEFAULT 0, accessible_profiles TEXT[] NOT NULL DEFAULT '{}',
      ig_account_id TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(`ALTER TABLE meta_pages ADD COLUMN IF NOT EXISTS ig_account_id TEXT`);

  const profile = profiles[opts.profileIndex];
  const pacer = new Pacer();
  report(`Descobrindo páginas: ${profile.name} (${opts.profileIndex + 1}/${total})`, opts.profileIndex, total);

  const pages = await discoverPagesForProfile(profile.token, pacer, (m) => report(`Perfil ${profile.name}: ${m}`, opts.profileIndex, total));

  const client = await pool.connect();
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

  const nextIndex = opts.profileIndex + 1;
  report(`${profile.name}: ${pages.length} páginas`, nextIndex, total);
  return { total, nextIndex, done: nextIndex >= total };
}

async function fetchAdsVolumePagedPaced<T = any>(
  initialUrl: string,
  pacer: Pacer,
): Promise<{ rows: T[]; ok: boolean }> {
  const results: T[] = [];
  let nextUrl: string | null = initialUrl;
  while (nextUrl) {
    const { data, error } = await fetchGraphWithRetry(nextUrl, 4, pacer);
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
