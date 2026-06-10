import { pool } from './db';
import { getMetaProfiles } from './config';

const API_VERSION = 'v19.0';

interface RawBM {
  id: string;
  name?: string;
}

interface RawCatalog {
  id: string;
  name?: string;
  product_count?: number;
  vertical?: string;
}

export interface CatalogEntry {
  id: string;
  name: string;
  product_count: number | null;
  vertical: string | null;
  relationship: 'owned' | 'client';
}

export interface BMWithCatalogs {
  bm_id: string;
  bm_name: string;
  accessible_profiles: string[];
  catalogs: CatalogEntry[];
}

export interface CatalogEndpointAttempt {
  endpoint: 'owned' | 'client';
  status: 'ok' | 'empty' | 'error';
  count: number;
  error_code: number | string | null;
  error_message: string | null;
}

export interface CatalogTokenAttempt {
  profile_name: string;
  token_preview: string; // primeiros 8 chars do token, pra debug sem vazar segredo
  endpoints: CatalogEndpointAttempt[];
}

export interface BMDiagnostic {
  bm_id: string;
  bm_name: string;
  total_catalogs: number;
  attempts: CatalogTokenAttempt[];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const TRANSIENT_GRAPH_CODES = new Set([1, 2, 4, 17, 32, 613]);

async function fetchGraphWithRetry(url: string, maxAttempts = 4): Promise<{ data: any; error: any | null }> {
  let attempt = 0;
  while (true) {
    attempt++;
    let res: Response | null = null;
    try {
      res = await fetch(url);
    } catch (networkErr) {
      if (attempt >= maxAttempts) return { data: null, error: { code: 'NETWORK', message: String(networkErr) } };
      await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
      continue;
    }
    let data: any;
    try { data = await res.json(); } catch { data = null; }

    if (data?.error) {
      const code = Number(data.error.code);
      if (TRANSIENT_GRAPH_CODES.has(code) && attempt < maxAttempts) {
        await sleep(Math.min(1000 * 2 ** (attempt - 1), 10000));
        continue;
      }
      return { data: null, error: data.error };
    }
    return { data, error: null };
  }
}

async function fetchAllPages<T = any>(url: string): Promise<T[]> {
  const results: T[] = [];
  let nextUrl: string | null = url;
  while (nextUrl) {
    const { data, error } = await fetchGraphWithRetry(nextUrl);
    if (error) {
      console.warn(`[meta-catalogs] Graph error (${error.code}): ${error.message ?? '—'}`);
      break;
    }
    if (Array.isArray(data?.data)) results.push(...data.data);
    nextUrl = data?.paging?.next ?? null;
  }
  return results;
}

// Direct BMs + sub-BMs. Tokens System User não veem catálogos em /me/*, por isso
// varremos cada BM (mesma lógica de meta-pages.ts).
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
    for (const ob of owned) if (!all.has(ob.id)) all.set(ob.id, ob);
  }
  return Array.from(all.values());
}

/**
 * Variante de fetchAllPages que devolve também a primeira condição de erro
 * encontrada, pra alimentar o diagnóstico. Se o primeiro fetch falha, retorna
 * [], error. Se as primeiras páginas vêm e depois falha, retorna o que veio +
 * o erro.
 */
async function fetchAllPagesWithError<T = any>(
  url: string
): Promise<{ data: T[]; error: any | null }> {
  const results: T[] = [];
  let nextUrl: string | null = url;
  let firstError: any = null;
  while (nextUrl) {
    const { data, error } = await fetchGraphWithRetry(nextUrl);
    if (error) {
      firstError = error;
      break;
    }
    if (Array.isArray(data?.data)) results.push(...data.data);
    nextUrl = data?.paging?.next ?? null;
  }
  return { data: results, error: firstError };
}

interface BmCatalogResult {
  catalogs: CatalogEntry[];
  endpoints: CatalogEndpointAttempt[];
}

async function fetchBmCatalogsDetailed(bmId: string, token: string): Promise<BmCatalogResult> {
  const fields = 'id,name,product_count,vertical';
  const [ownedRes, clientRes] = await Promise.all([
    fetchAllPagesWithError<RawCatalog>(
      `https://graph.facebook.com/${API_VERSION}/${bmId}/owned_product_catalogs?fields=${fields}&limit=200&access_token=${token}`
    ),
    fetchAllPagesWithError<RawCatalog>(
      `https://graph.facebook.com/${API_VERSION}/${bmId}/client_product_catalogs?fields=${fields}&limit=200&access_token=${token}`
    ),
  ]);

  const seen = new Set<string>();
  const out: CatalogEntry[] = [];

  for (const c of ownedRes.data) {
    if (!c.id || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({
      id: c.id,
      name: c.name || c.id,
      product_count: typeof c.product_count === 'number' ? c.product_count : null,
      vertical: c.vertical ?? null,
      relationship: 'owned',
    });
  }
  for (const c of clientRes.data) {
    if (!c.id || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({
      id: c.id,
      name: c.name || c.id,
      product_count: typeof c.product_count === 'number' ? c.product_count : null,
      vertical: c.vertical ?? null,
      relationship: 'client',
    });
  }

  const buildAttempt = (
    endpoint: 'owned' | 'client',
    res: { data: RawCatalog[]; error: any | null }
  ): CatalogEndpointAttempt => ({
    endpoint,
    status: res.error ? 'error' : res.data.length === 0 ? 'empty' : 'ok',
    count: res.data.length,
    error_code: res.error?.code ?? null,
    error_message: res.error?.message ?? null,
  });

  return {
    catalogs: out,
    endpoints: [buildAttempt('owned', ownedRes), buildAttempt('client', clientRes)],
  };
}

async function ensureCatalogsTable() {
  // (bm_id, catalog_id) é a PK porque o mesmo catálogo pode aparecer como
  // 'owned' numa BM e 'client' em outra. Queremos guardar as duas relações.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS meta_catalogs (
      bm_id               TEXT NOT NULL,
      bm_name             TEXT NOT NULL,
      catalog_id          TEXT NOT NULL,
      catalog_name        TEXT NOT NULL,
      product_count       INTEGER,
      vertical            TEXT,
      relationship        TEXT NOT NULL,
      accessible_profiles TEXT[] NOT NULL DEFAULT '{}',
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (bm_id, catalog_id)
    )
  `);
}

export async function getCatalogsFromDB(): Promise<BMWithCatalogs[]> {
  await ensureCatalogsTable();
  const { rows } = await pool.query(
    `SELECT bm_id, bm_name, catalog_id, catalog_name, product_count, vertical, relationship, accessible_profiles
       FROM meta_catalogs
      ORDER BY bm_name ASC, catalog_name ASC`
  );

  const byBm = new Map<string, BMWithCatalogs>();
  for (const r of rows) {
    let entry = byBm.get(r.bm_id);
    if (!entry) {
      entry = {
        bm_id: r.bm_id,
        bm_name: r.bm_name,
        accessible_profiles: Array.isArray(r.accessible_profiles) ? r.accessible_profiles : [],
        catalogs: [],
      };
      byBm.set(r.bm_id, entry);
    }
    entry.catalogs.push({
      id: r.catalog_id,
      name: r.catalog_name,
      product_count: r.product_count,
      vertical: r.vertical,
      relationship: r.relationship,
    });
  }
  return Array.from(byBm.values());
}

/**
 * Descobre todas as BMs candidatas para a varredura de catálogos, vindas de
 * DUAS fontes:
 *   1) `meta_ad_accounts`: BMs já catalogadas pelo sync de contas (autoritativo
 *      no projeto — captura toda BM que tem pelo menos uma ad account).
 *   2) `me/businesses` + `owned_businesses` por perfil: pega BMs novas ou BMs
 *      sem ad account.
 *
 * Para cada BM, mantém um conjunto de (profileName → token) candidatos. Quando
 * varremos os catálogos, tentamos cada token até retornar alguma coisa — token
 * que falha por falta de permissão simplesmente não contribui.
 */
async function discoverBmCandidates(
  onProgress?: (msg: string) => void
): Promise<Map<string, { id: string; name: string; tokensByProfile: Map<string, string> }>> {
  const report = (msg: string) => { try { onProgress?.(msg); } catch {} };
  const profiles = await getMetaProfiles();

  // token → profile name (pra mapear o access_token armazenado em meta_ad_accounts)
  const profileByToken = new Map<string, string>();
  for (const p of profiles) {
    if (p.token) profileByToken.set(p.token, p.name);
  }

  type Cand = { id: string; name: string; tokensByProfile: Map<string, string> };
  const candidates = new Map<string, Cand>();

  // Fonte 1: meta_ad_accounts (BMs já descobertas em syncs anteriores)
  try {
    const { rows } = await pool.query(`
      SELECT bm_id, MAX(bm_name) AS bm_name,
             ARRAY_AGG(DISTINCT access_token) FILTER (
               WHERE access_token IS NOT NULL AND access_token <> ''
             ) AS tokens
        FROM meta_ad_accounts
       WHERE bm_id IS NOT NULL AND bm_id <> 'Personal'
       GROUP BY bm_id
    `);
    for (const r of rows) {
      const cand: Cand = candidates.get(r.bm_id) ?? {
        id: r.bm_id,
        name: r.bm_name ?? r.bm_id,
        tokensByProfile: new Map(),
      };
      for (const tok of (r.tokens ?? []) as string[]) {
        if (!tok) continue;
        const profileName = profileByToken.get(tok) ?? `account_token:${tok.slice(0, 8)}`;
        if (!cand.tokensByProfile.has(profileName)) cand.tokensByProfile.set(profileName, tok);
      }
      candidates.set(r.bm_id, cand);
    }
    report(`Descobertas ${rows.length} BMs em meta_ad_accounts`);
  } catch (err: any) {
    console.warn(`[meta-catalogs] falha lendo BMs de meta_ad_accounts: ${err?.message ?? err}`);
  }

  // Fonte 2: me/businesses + owned_businesses por perfil
  for (const profile of profiles) {
    if (!profile.token) continue;
    report(`Perfil ${profile.name}: listando BMs via me/businesses…`);
    try {
      const bms = await listAllBMs(profile.token);
      for (const bm of bms) {
        const cand: Cand = candidates.get(bm.id) ?? {
          id: bm.id,
          name: bm.name ?? bm.id,
          tokensByProfile: new Map(),
        };
        if (!cand.tokensByProfile.has(profile.name)) {
          cand.tokensByProfile.set(profile.name, profile.token);
        }
        if (bm.name && (!cand.name || cand.name === cand.id)) cand.name = bm.name;
        candidates.set(bm.id, cand);
      }
    } catch (err: any) {
      console.warn(`[meta-catalogs] perfil ${profile.name} falhou listando BMs: ${err?.message ?? err}`);
    }
  }

  return candidates;
}

/**
 * Varre todas as BMs candidatas, busca owned + client product catalogs em cada
 * BM tentando cada token disponível, e persiste no Postgres. Linhas que não
 * foram vistas neste sync são removidas — catálogos removidos da Meta somem.
 *
 * BMs com 0 catálogos NÃO são persistidas (a lista é "catálogos agrupados por
 * BM" — BM sem catálogo é ruído).
 */
export async function fetchAndSyncMetaCatalogs(
  onProgress?: (message: string) => void
): Promise<{ success: true; count: number; groups: BMWithCatalogs[]; diagnostics: BMDiagnostic[] }> {
  const report = (msg: string) => { try { onProgress?.(msg); } catch {} };

  const profiles = await getMetaProfiles();
  if (profiles.length === 0) {
    throw new Error('META_PROFILES não configurado. Configure os tokens em /api-config.');
  }

  await ensureCatalogsTable();

  const candidates = await discoverBmCandidates(report);
  const candList = Array.from(candidates.values());
  report(`Total de BMs candidatas: ${candList.length}`);

  type Acc = {
    bm_id: string;
    bm_name: string;
    accessible_profiles: Set<string>;
    catalogs: Map<string, CatalogEntry>;
  };
  const byBm = new Map<string, Acc>();
  const diagnostics: BMDiagnostic[] = [];

  for (let i = 0; i < candList.length; i++) {
    const bm = candList[i];
    report(`BM ${i + 1}/${candList.length}: ${bm.name}`);

    const entry: Acc = {
      bm_id: bm.id,
      bm_name: bm.name,
      accessible_profiles: new Set(),
      catalogs: new Map(),
    };
    const bmDiag: BMDiagnostic = {
      bm_id: bm.id,
      bm_name: bm.name,
      total_catalogs: 0,
      attempts: [],
    };

    // Tenta cada token candidato. Tokens sem permissão para o BM contribuem
    // 0 catálogos mas o erro é registrado no diagnóstico (útil pra saber se
    // é falta de catálogo ou falta de permissão do token).
    for (const [profileName, token] of bm.tokensByProfile.entries()) {
      let result: BmCatalogResult = { catalogs: [], endpoints: [] };
      try {
        result = await fetchBmCatalogsDetailed(bm.id, token);
      } catch (err: any) {
        console.warn(`[meta-catalogs] BM ${bm.id} via ${profileName} falhou: ${err?.message ?? err}`);
        result = {
          catalogs: [],
          endpoints: [
            { endpoint: 'owned',  status: 'error', count: 0, error_code: 'EXCEPTION', error_message: String(err?.message ?? err) },
            { endpoint: 'client', status: 'error', count: 0, error_code: 'EXCEPTION', error_message: String(err?.message ?? err) },
          ],
        };
      }

      bmDiag.attempts.push({
        profile_name: profileName,
        token_preview: token.slice(0, 8) + '…',
        endpoints: result.endpoints,
      });

      if (result.catalogs.length > 0) {
        entry.accessible_profiles.add(profileName);
        for (const c of result.catalogs) {
          if (!entry.catalogs.has(c.id)) entry.catalogs.set(c.id, c);
        }
      }
    }

    bmDiag.total_catalogs = entry.catalogs.size;
    diagnostics.push(bmDiag);

    if (entry.catalogs.size > 0) byBm.set(bm.id, entry);

    if (i < candList.length - 1) await sleep(80);
  }

  // Persistência: usa um sync_started_at pra apagar linhas estale ao final.
  // Todos os upserts dentro de uma única transação.
  const syncStartedAt = new Date();
  const groups: BMWithCatalogs[] = [];
  let rowCount = 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const e of byBm.values()) {
      const profileArr = Array.from(e.accessible_profiles);
      for (const c of e.catalogs.values()) {
        await client.query(
          `INSERT INTO meta_catalogs
             (bm_id, bm_name, catalog_id, catalog_name, product_count, vertical, relationship, accessible_profiles, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
           ON CONFLICT (bm_id, catalog_id) DO UPDATE SET
             bm_name             = EXCLUDED.bm_name,
             catalog_name        = EXCLUDED.catalog_name,
             product_count       = EXCLUDED.product_count,
             vertical            = EXCLUDED.vertical,
             relationship        = EXCLUDED.relationship,
             accessible_profiles = EXCLUDED.accessible_profiles,
             updated_at          = now()`,
          [
            e.bm_id,
            e.bm_name,
            c.id,
            c.name,
            c.product_count,
            c.vertical,
            c.relationship,
            profileArr,
          ]
        );
        rowCount++;
      }
    }
    // Apaga linhas que não foram tocadas neste sync (catálogos/BMs sumiram da Meta)
    await client.query(`DELETE FROM meta_catalogs WHERE updated_at < $1`, [syncStartedAt]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[meta-catalogs] erro salvando no Postgres:', err);
    throw err;
  } finally {
    client.release();
  }

  // Devolve o snapshot fresco já no formato agrupado
  for (const e of byBm.values()) {
    groups.push({
      bm_id: e.bm_id,
      bm_name: e.bm_name,
      accessible_profiles: Array.from(e.accessible_profiles),
      catalogs: Array.from(e.catalogs.values()).sort((a, b) => a.name.localeCompare(b.name)),
    });
  }
  groups.sort((a, b) => a.bm_name.localeCompare(b.bm_name));

  diagnostics.sort((a, b) => a.bm_name.localeCompare(b.bm_name));

  report(`Sync concluído: ${rowCount} catálogos em ${groups.length} BMs`);
  return { success: true, count: rowCount, groups, diagnostics };
}

// ────────────────────────────────────────────────────────────────────────────
// Criação de catálogo (POST /{bm_id}/owned_product_catalogs)
// ────────────────────────────────────────────────────────────────────────────

export class CreateCatalogError extends Error {
  constructor(public code: number | string | null, message: string, public raw?: any) {
    super(message);
    this.name = 'CreateCatalogError';
  }
}

function buildMetaErrorMessage(err: any): string {
  if (!err || typeof err !== 'object') return 'Erro Meta';
  const parts: string[] = [];
  if (err.error_user_title) parts.push(String(err.error_user_title));
  if (err.error_user_msg && err.error_user_msg !== err.error_user_title) parts.push(String(err.error_user_msg));
  if (err.message && err.message !== err.error_user_title && err.message !== err.error_user_msg) parts.push(String(err.message));
  const meta: string[] = [];
  if (err.code !== undefined) meta.push(`code ${err.code}`);
  if (err.error_subcode) meta.push(`subcode ${err.error_subcode}`);
  if (err.fbtrace_id) meta.push(`trace ${err.fbtrace_id}`);
  if (meta.length) parts.push(`(${meta.join(' · ')})`);
  return parts.join(' — ') || 'Erro Meta';
}

export interface BmOption {
  bm_id: string;
  bm_name: string;
}

/**
 * BMs disponíveis para criar catálogos, lidos direto de `meta_ad_accounts`
 * (instantâneo, sem chamada à Meta). Cobre toda BM com ao menos uma ad account.
 * O dropdown global do "Criar catálogo" consome isto.
 */
export async function listBmsForCatalogCreation(): Promise<BmOption[]> {
  const { rows } = await pool.query(`
    SELECT bm_id, MAX(bm_name) AS bm_name
      FROM meta_ad_accounts
     WHERE bm_id IS NOT NULL AND bm_id <> '' AND bm_id <> 'Personal'
     GROUP BY bm_id
     ORDER BY MAX(bm_name) ASC NULLS LAST
  `);
  return rows.map((r: any) => ({ bm_id: r.bm_id, bm_name: r.bm_name ?? r.bm_id }));
}

/**
 * Resolve um token Meta com acesso ao BM pra criar o catálogo.
 * Ordem: (1) tokens de `meta_ad_accounts` do BM; (2) perfis de
 * `meta_catalogs.accessible_profiles` (BM com catálogo mas sem ad account);
 * (3) primeiro perfil configurado (a Meta dirá se não tem permissão).
 */
async function resolveBmToken(bmId: string): Promise<{ profileName: string; token: string } | null> {
  const profiles = await getMetaProfiles();
  if (profiles.length === 0) return null;
  const nameByToken = new Map<string, string>();
  for (const p of profiles) if (p.token) nameByToken.set(p.token, p.name);

  // 1) tokens de meta_ad_accounts pra esse BM
  try {
    const { rows } = await pool.query(
      `SELECT ARRAY_AGG(DISTINCT access_token) FILTER (
                WHERE access_token IS NOT NULL AND access_token <> ''
              ) AS tokens
         FROM meta_ad_accounts
        WHERE bm_id = $1`,
      [bmId]
    );
    for (const tok of ((rows[0]?.tokens ?? []) as string[])) {
      if (tok) return { profileName: nameByToken.get(tok) ?? `account_token:${tok.slice(0, 8)}`, token: tok };
    }
  } catch (err: any) {
    console.warn(`[meta-catalogs] resolveBmToken meta_ad_accounts falhou: ${err?.message ?? err}`);
  }

  // 2) accessible_profiles de meta_catalogs (BM com catálogo, sem ad account)
  try {
    const { rows } = await pool.query(
      `SELECT accessible_profiles FROM meta_catalogs WHERE bm_id = $1 LIMIT 1`,
      [bmId]
    );
    for (const name of ((rows[0]?.accessible_profiles ?? []) as string[])) {
      const p = profiles.find((x) => x.name === name);
      if (p?.token) return { profileName: p.name, token: p.token };
    }
  } catch (err: any) {
    console.warn(`[meta-catalogs] resolveBmToken meta_catalogs falhou: ${err?.message ?? err}`);
  }

  // 3) fallback: primeiro perfil configurado
  if (profiles[0]?.token) return { profileName: profiles[0].name, token: profiles[0].token };
  return null;
}

/** Resolve o nome do BM (meta_ad_accounts primeiro, depois meta_catalogs). */
async function resolveBmName(bmId: string): Promise<string | null> {
  try {
    const { rows } = await pool.query(`SELECT MAX(bm_name) AS n FROM meta_ad_accounts WHERE bm_id = $1`, [bmId]);
    if (rows[0]?.n) return rows[0].n as string;
  } catch {}
  try {
    const { rows } = await pool.query(`SELECT bm_name FROM meta_catalogs WHERE bm_id = $1 LIMIT 1`, [bmId]);
    if (rows[0]?.bm_name) return rows[0].bm_name as string;
  } catch {}
  return null;
}

export interface CreateCatalogResult {
  bm_id: string;
  bm_name: string;
  catalog: CatalogEntry;
  accessible_profiles: string[];
  profile_used: string;
}

/**
 * Cria um catálogo `commerce` no BM via Graph API e espelha a linha em
 * `meta_catalogs` (idêntica ao que o sync escreveria), para que o catálogo
 * sobreviva ao "Recarregar" sem precisar de um sync completo.
 */
export async function createMetaCatalog(bmId: string, name: string): Promise<CreateCatalogResult> {
  const bm = (bmId ?? '').trim();
  const catalogName = (name ?? '').trim();
  if (!bm) throw new CreateCatalogError('INVALID_INPUT', 'bm_id obrigatório');
  if (!catalogName) throw new CreateCatalogError('INVALID_INPUT', 'Nome do catálogo obrigatório');

  const tokenInfo = await resolveBmToken(bm);
  if (!tokenInfo) {
    throw new CreateCatalogError('NO_TOKEN', `Nenhum token Meta com acesso ao BM ${bm}. Configure os tokens em /api-config.`);
  }

  const bmName = (await resolveBmName(bm)) ?? bm;

  // POST cria o catálogo. vertical fixo em 'commerce' (único que o app consome).
  const body = new URLSearchParams();
  body.append('name', catalogName);
  body.append('vertical', 'commerce');
  body.append('access_token', tokenInfo.token);

  const res = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${bm}/owned_product_catalogs`,
    { method: 'POST', body }
  );
  const data: any = await res.json().catch(() => ({}));
  if (data?.error) {
    throw new CreateCatalogError(data.error.code, buildMetaErrorMessage(data.error), data.error);
  }
  const catalogId = data?.id;
  if (!catalogId) {
    throw new CreateCatalogError('NO_ID', 'A Meta não retornou o id do catálogo criado.', data);
  }

  const accessible = [tokenInfo.profileName];
  const entry: CatalogEntry = {
    id: String(catalogId),
    name: catalogName,
    product_count: 0,
    vertical: 'commerce',
    relationship: 'owned',
  };

  // Espelha a linha em meta_catalogs (não sobrescreve product_count em conflito).
  await ensureCatalogsTable();
  await pool.query(
    `INSERT INTO meta_catalogs
       (bm_id, bm_name, catalog_id, catalog_name, product_count, vertical, relationship, accessible_profiles, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
     ON CONFLICT (bm_id, catalog_id) DO UPDATE SET
       bm_name             = EXCLUDED.bm_name,
       catalog_name        = EXCLUDED.catalog_name,
       vertical            = EXCLUDED.vertical,
       relationship        = EXCLUDED.relationship,
       accessible_profiles = EXCLUDED.accessible_profiles,
       updated_at          = now()`,
    [bm, bmName, entry.id, entry.name, 0, entry.vertical, entry.relationship, accessible]
  );

  return { bm_id: bm, bm_name: bmName, catalog: entry, accessible_profiles: accessible, profile_used: tokenInfo.profileName };
}
