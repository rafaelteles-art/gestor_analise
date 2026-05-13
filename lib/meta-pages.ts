import { pool } from './db';
import { getMetaProfiles } from './config';

const API_VERSION = 'v19.0';

interface RawPage {
  id: string;
  name?: string;
}

interface RawAdAccount {
  id: string;          // "act_XXXXX"
  account_id?: string; // "XXXXX"
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

export interface PageWithAdLimit {
  page_id: string;
  page_name: string;
  ad_limit: number | null;   // null quando a Graph API não retorna limite
  ads_running: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Erros transitórios da Graph onde vale a pena retry com backoff.
//   1  → "Please reduce the amount of data" (resposta grande / sobrecarga)
//   2  → "Service temporarily unavailable"
//   4  → "Application request limit reached" (rate limit)
//   17 → "User request limit reached" (rate limit por usuário)
//   32 → "Page request limit reached"
//   613→ "Calls to this api have exceeded the rate limit"
const TRANSIENT_GRAPH_CODES = new Set([1, 2, 4, 17, 32, 613]);

/**
 * GET um endpoint do Graph com retry/backoff em erros transitórios.
 * Retorna `{ data, error }` — `error` populado se desistimos.
 */
async function fetchGraphWithRetry(url: string, maxAttempts = 5): Promise<{ data: any; error: any | null }> {
  let attempt = 0;
  while (true) {
    attempt++;
    let res: Response | null = null;
    try {
      res = await fetch(url);
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

/**
 * Pagina ads_volume — endpoint pesado por padrão. Se em uma página específica
 * a Graph reclamar de "reduce the amount of data" (#1) mesmo após retries,
 * reduz o `limit` da URL pela metade e tenta de novo, até `limit=5`.
 *
 * Funciona porque (#1) escala com o tamanho da resposta — diminuir `limit=N`
 * sempre resolve, só fica mais lento.
 */
async function fetchAdsVolumePaged<T = any>(initialUrl: string): Promise<T[]> {
  const results: T[] = [];
  let nextUrl: string | null = initialUrl;

  while (nextUrl) {
    const { data, error } = await fetchGraphWithRetry(nextUrl, 4);

    if (error) {
      const code = Number(error.code);
      if (code === 1) {
        // Resposta ainda grande demais — corta o limit ao meio e tenta de novo.
        const u = new URL(nextUrl);
        const currentLimit = Number(u.searchParams.get('limit') ?? '100');
        const newLimit = Math.max(5, Math.floor(currentLimit / 2));
        if (newLimit < currentLimit) {
          console.warn(`[meta-pages] ads_volume reduzindo limit: ${currentLimit} → ${newLimit}`);
          u.searchParams.set('limit', String(newLimit));
          nextUrl = u.toString();
          continue;
        }
      }
      console.warn(`[meta-pages] ads_volume error (${error.code}): ${error.message ?? '—'}`);
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
 * Para 1 token: busca páginas + ad accounts + ads_volume por ad account,
 * e junta tudo numa lista de páginas com ad_limit e ads_running.
 *
 * Tokens System User do REPORT NÃO retornam nada em me/accounts/me/adaccounts,
 * então varremos BMs (owned_pages + client_pages + owned/client_ad_accounts)
 * — tudo isolado por try/erro pra um BM/ad account problemático não derrubar
 * o restante.
 */
export async function fetchPagesWithAdLimits(
  token: string,
  onProgress?: (message: string) => void
): Promise<PageWithAdLimit[]> {
  const report = (msg: string) => { try { onProgress?.(msg); } catch {} };
  // 1) Descobre todos os BMs visíveis ao token (diretos + sub-BMs)
  const bms = await listAllBMs(token);

  // 2) Páginas — união de me/accounts (token pessoal) + BM owned/client_pages.
  //    Para System User, me/accounts retorna erro/vazio mas o walk de BM cobre.
  const pagesMap = new Map<string, string>();

  const personalPages = await fetchAllPages<RawPage>(
    `https://graph.facebook.com/${API_VERSION}/me/accounts?fields=id,name&limit=200&access_token=${token}`
  );
  for (const p of personalPages) {
    if (p.id) pagesMap.set(p.id, p.name ?? p.id);
  }

  for (const bm of bms) {
    const [owned, client] = await Promise.all([
      fetchAllPages<RawPage>(
        `https://graph.facebook.com/${API_VERSION}/${bm.id}/owned_pages?fields=id,name&limit=200&access_token=${token}`
      ),
      fetchAllPages<RawPage>(
        `https://graph.facebook.com/${API_VERSION}/${bm.id}/client_pages?fields=id,name&limit=200&access_token=${token}`
      ),
    ]);
    for (const p of [...owned, ...client]) {
      if (p.id && !pagesMap.has(p.id)) pagesMap.set(p.id, p.name ?? p.id);
    }
  }

  // 3) Ad accounts — união de me/adaccounts + BM owned/client_ad_accounts
  const adAccountsMap = new Map<string, RawAdAccount>();

  const personalAcc = await fetchAllPages<RawAdAccount>(
    `https://graph.facebook.com/${API_VERSION}/me/adaccounts?fields=id,account_id&limit=200&access_token=${token}`
  );
  for (const a of personalAcc) {
    if (a.id) adAccountsMap.set(a.id, a);
  }

  for (const bm of bms) {
    const [owned, client] = await Promise.all([
      fetchAllPages<RawAdAccount>(
        `https://graph.facebook.com/${API_VERSION}/${bm.id}/owned_ad_accounts?fields=id,account_id&limit=200&access_token=${token}`
      ),
      fetchAllPages<RawAdAccount>(
        `https://graph.facebook.com/${API_VERSION}/${bm.id}/client_ad_accounts?fields=id,account_id&limit=200&access_token=${token}`
      ),
    ]);
    for (const a of [...owned, ...client]) {
      if (a.id && !adAccountsMap.has(a.id)) adAccountsMap.set(a.id, a);
    }
  }

  const adAccounts = Array.from(adAccountsMap.values());

  if (pagesMap.size === 0 && adAccounts.length === 0) return [];

  // 4) ads_volume por ad account — SEQUENCIAL (sem paralelismo) pra eliminar
  //    completamente (#1) "Please reduce the amount of data" e (#4) rate limit.
  //    `fetchAdsVolumePaged` ainda reduz `limit` automaticamente se uma página
  //    individual for grande demais. Pega MAX entre ocorrências da mesma
  //    página em múltiplas ad accounts (não soma — os contadores já são por
  //    página).
  const pageLimits = new Map<string, number>();
  const pageRunning = new Map<string, number>();

  const fields = [
    'actor_id',
    'actor_name',
    'ads_running_or_in_review_count',
    'limit_on_ads_running_or_in_review',
    'current_account_ads_running_or_in_review_count',
  ].join(',');

  for (let i = 0; i < adAccounts.length; i++) {
    const acc = adAccounts[i];
    if (i % 10 === 0 || i === adAccounts.length - 1) {
      report(`Lendo ads_volume: ${i + 1}/${adAccounts.length} ad accounts`);
    }

    const url =
      `https://graph.facebook.com/${API_VERSION}/${acc.id}/ads_volume` +
      `?show_breakdown_by_actor=true&fields=${fields}&limit=50&access_token=${token}`;

    let rows: AdsVolumeRow[] = [];
    try {
      rows = await fetchAdsVolumePaged<AdsVolumeRow>(url);
    } catch (err: any) {
      console.warn(`[meta-pages] ads_volume falhou em ${acc.id}: ${err?.message ?? err}`);
    }

    for (const row of rows) {
      const actorId = row.actor_id;
      if (!actorId) continue;

      // Se a página aparece em ads_volume mas não estava no walk de BM
      // (ex.: page emprestada de outro BM), registra com actor_name.
      if (!pagesMap.has(actorId) && row.actor_name) {
        pagesMap.set(actorId, row.actor_name);
      }

      const running = row.ads_running_or_in_review_count;
      if (typeof running === 'number') {
        pageRunning.set(actorId, Math.max(pageRunning.get(actorId) ?? 0, running));
      }

      const limit = row.limit_on_ads_running_or_in_review;
      if (typeof limit === 'number') {
        const current = pageLimits.get(actorId);
        if (current === undefined || limit > current) {
          pageLimits.set(actorId, limit);
        }
      }
    }

    // Pequena pausa entre ad accounts pra ficar abaixo do rate limit por usuário.
    if (i < adAccounts.length - 1) await sleep(150);
  }

  // 5) Resultado final, uma entrada por página descoberta
  return Array.from(pagesMap.entries()).map(([page_id, page_name]) => ({
    page_id,
    page_name,
    ad_limit: pageLimits.get(page_id) ?? null,
    ads_running: pageRunning.get(page_id) ?? 0,
  }));
}

/**
 * Sync multi-perfil:
 *   - Lê todos os perfis Meta em app_settings (via getMetaProfiles)
 *   - Para cada um, roda fetchPagesWithAdLimits
 *   - Deduplica por page_id, mantendo MAX(ad_limit) e MAX(ads_running) entre perfis
 *     e a união dos accessible_profiles
 *   - Faz upsert na tabela meta_pages (criada on-demand)
 */
export async function fetchAndSyncMetaPages(onProgress?: (message: string) => void) {
  const report = (msg: string) => { try { onProgress?.(msg); } catch {} };

  const profiles = await getMetaProfiles();
  if (profiles.length === 0) {
    throw new Error('META_PROFILES não configurado. Configure os tokens em /api-config.');
  }

  // Garante a tabela. CREATE TABLE IF NOT EXISTS é idempotente.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS meta_pages (
      page_id              TEXT PRIMARY KEY,
      page_name            TEXT NOT NULL,
      ad_limit             INTEGER,
      ads_running          INTEGER NOT NULL DEFAULT 0,
      accessible_profiles  TEXT[]  NOT NULL DEFAULT '{}',
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Acumula por page_id ao longo de todos os perfis
  type Acc = {
    page_id: string;
    page_name: string;
    ad_limit: number | null;
    ads_running: number;
    accessible_profiles: Set<string>;
  };
  const accByPage = new Map<string, Acc>();

  for (const profile of profiles) {
    if (!profile.token) continue;

    report(`Perfil ${profile.name}: buscando páginas e limites…`);
    let pages: PageWithAdLimit[];
    try {
      pages = await fetchPagesWithAdLimits(profile.token, (msg) =>
        report(`Perfil ${profile.name}: ${msg}`)
      );
    } catch (err: any) {
      console.warn(`[meta-pages] perfil ${profile.name} falhou: ${err?.message ?? err}`);
      report(`Perfil ${profile.name}: erro — ${err?.message ?? err}`);
      continue;
    }

    report(`Perfil ${profile.name}: ${pages.length} páginas encontradas`);

    for (const p of pages) {
      const existing = accByPage.get(p.page_id);
      if (!existing) {
        accByPage.set(p.page_id, {
          page_id: p.page_id,
          page_name: p.page_name,
          ad_limit: p.ad_limit,
          ads_running: p.ads_running,
          accessible_profiles: new Set([profile.name]),
        });
      } else {
        existing.accessible_profiles.add(profile.name);
        // Sempre prefere um nome não-vazio se o anterior estiver vazio
        if (!existing.page_name && p.page_name) existing.page_name = p.page_name;
        // MAX entre perfis (cobre casos em que um perfil vê limites maiores)
        if (p.ad_limit !== null && (existing.ad_limit === null || p.ad_limit > existing.ad_limit)) {
          existing.ad_limit = p.ad_limit;
        }
        if (p.ads_running > existing.ads_running) existing.ads_running = p.ads_running;
      }
    }
  }

  const rows = Array.from(accByPage.values());
  report(`Salvando ${rows.length} páginas no banco…`);

  if (rows.length > 0) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const r of rows) {
        await client.query(
          `INSERT INTO meta_pages (page_id, page_name, ad_limit, ads_running, accessible_profiles, updated_at)
           VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (page_id) DO UPDATE SET
             page_name           = EXCLUDED.page_name,
             ad_limit            = EXCLUDED.ad_limit,
             ads_running         = EXCLUDED.ads_running,
             accessible_profiles = EXCLUDED.accessible_profiles,
             updated_at          = now()`,
          [
            r.page_id,
            r.page_name,
            r.ad_limit,
            r.ads_running,
            Array.from(r.accessible_profiles),
          ]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[meta-pages] erro salvando no Postgres:', err);
      throw err;
    } finally {
      client.release();
    }
  }

  return { success: true, count: rows.length, pages: rows };
}
