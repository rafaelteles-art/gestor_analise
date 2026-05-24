/**
 * Criação de produtos e product sets diretamente via Graph API
 * (sem feed de planilha). Usado pela página /catalogo para adicionar
 * produtos a um catálogo + criar o conjunto correspondente.
 *
 * Refs:
 *  - POST /{catalog_id}/products       (campos: retailer_id, name, description, link, image_url, price, currency, brand, availability, condition, ...)
 *  - POST /{catalog_id}/product_sets   (campos: name, filter: {retailer_id:{eq:...}})
 */

import { pool } from './db';
import { getMetaProfiles } from './config';

const API_VERSION = 'v21.0';
const GRAPH = `https://graph.facebook.com/${API_VERSION}`;

// ────────────────────────────────────────────────────────────────────────────
// Tipos
// ────────────────────────────────────────────────────────────────────────────

export interface ProductPresetConfig {
  description: string;
  link: string;
  image_url: string;
  /** Em centavos? Não — a Meta espera "preço com moeda" como string ("9.99 USD")
   *  ou number em centavos via `price`. Aqui guardamos o valor decimal em string
   *  ("97.00") junto com o currency separado. Convertemos antes do POST. */
  price: string;
  currency: string;
  brand: string;
  availability: 'in stock' | 'out of stock' | 'preorder' | 'available for order' | 'discontinued';
  condition: 'new' | 'refurbished' | 'used';
}

export interface CreateProductInput {
  catalogId: string;
  bmId: string;
  /** Nome do anúncio (ex: "LT1100"). Usado APENAS para gerar o retailer_id (`${ad}-${dd-mm}`). */
  adName: string;
  /** Título do produto (campo `name` na Meta). Editável livre pelo usuário. */
  productName: string;
  preset: ProductPresetConfig;
}

export interface CreateProductResult {
  product_id: string;
  product_set_id: string;
  retailer_id: string;
  product_name: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Erros
// ────────────────────────────────────────────────────────────────────────────

export class MetaCatalogApiError extends Error {
  constructor(
    public step: string,
    public code: number | string | null,
    message: string,
    public raw?: any,
  ) {
    super(message);
    this.name = 'MetaCatalogApiError';
  }
}

function buildMetaErrorMessage(err: any): string {
  if (!err || typeof err !== 'object') return 'Erro Meta';
  const parts: string[] = [];
  const title = err.error_user_title;
  const userMsg = err.error_user_msg;
  const baseMsg = err.message;
  if (title) parts.push(String(title));
  if (userMsg && userMsg !== title) parts.push(String(userMsg));
  if (baseMsg && baseMsg !== title && baseMsg !== userMsg) parts.push(String(baseMsg));
  const meta: string[] = [];
  if (err.code !== undefined) meta.push(`code ${err.code}`);
  if (err.error_subcode !== undefined && err.error_subcode !== 0) meta.push(`subcode ${err.error_subcode}`);
  if (err.fbtrace_id) meta.push(`trace ${err.fbtrace_id}`);
  if (meta.length) parts.push(`(${meta.join(' · ')})`);
  return parts.join(' — ') || 'Erro Meta';
}

// ────────────────────────────────────────────────────────────────────────────
// HTTP helpers
// ────────────────────────────────────────────────────────────────────────────

async function postGraph<T>(path: string, params: Record<string, unknown>, token: string, step: string): Promise<T> {
  const url = `${GRAPH}/${path}`;
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    body.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  body.append('access_token', token);

  const res = await fetch(url, { method: 'POST', body });
  const data: any = await res.json().catch(() => ({}));
  if (data?.error) {
    throw new MetaCatalogApiError(step, data.error.code, buildMetaErrorMessage(data.error), data.error);
  }
  return data as T;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Cria product_set com retry exponencial no sub-código 1798130 (empty set).
 *
 * Esse erro acontece quando a Meta ainda não indexou o produto recém-criado e
 * o filtro retailer_id == <novo_id> não casa com nada. Em criações em lote,
 * o primeiro item funciona (Meta teve tempo entre testes anteriores), mas o
 * segundo em diante falha porque o POST do product e do set acontecem
 * milissegundos depois. Retry resolve.
 */
async function createProductSetWithRetry(
  catalogId: string,
  name: string,
  retailerId: string,
  token: string,
): Promise<{ id: string }> {
  const delays = [800, 1500, 3000, 6000]; // total ~11s no pior caso
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await postGraph<{ id: string }>(
        `${catalogId}/product_sets`,
        { name, filter: { retailer_id: { eq: retailerId } } },
        token,
        'createProductSet',
      );
    } catch (err: any) {
      const isEmptySetError = err?.raw?.error_subcode === 1798130;
      if (!isEmptySetError || attempt >= delays.length) throw err;
      await sleep(delays[attempt]);
    }
  }
  throw new MetaCatalogApiError('createProductSet', 'RETRY_EXHAUSTED', 'Retry esgotado no createProductSet');
}

// ────────────────────────────────────────────────────────────────────────────
// Token resolution
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolve o token Meta apropriado pra falar com o BM dono do catálogo.
 *
 * Estratégia: lê `meta_catalogs.accessible_profiles[]` (preenchido pelo sync) e
 * pega o primeiro perfil que ainda tem token válido em `META_PROFILES`. Se nada
 * casar, faz fallback pro primeiro token configurado — a Meta dirá se não tem
 * permissão. Retorna { profileName, token, bmId } pra logging.
 */
async function resolveCatalogToken(catalogId: string): Promise<{ profileName: string; token: string; bmId: string } | null> {
  const { rows } = await pool.query(
    `SELECT bm_id, accessible_profiles
       FROM meta_catalogs
      WHERE catalog_id = $1
      LIMIT 1`,
    [catalogId],
  );
  if (rows.length === 0) return null;

  const bmId = rows[0].bm_id as string;
  const profiles = await getMetaProfiles();
  if (profiles.length === 0) return null;

  const accessible = (rows[0].accessible_profiles ?? []) as string[];
  for (const name of accessible) {
    const p = profiles.find((x) => x.name === name);
    if (p?.token) return { profileName: p.name, token: p.token, bmId };
  }
  // Fallback: primeiro perfil configurado
  return { profileName: profiles[0].name, token: profiles[0].token, bmId };
}

// ────────────────────────────────────────────────────────────────────────────
// Sanitização + formatação
// ────────────────────────────────────────────────────────────────────────────

/**
 * Sanitiza nome do anúncio para usar como retailer_id.
 * Remove acentos, espaços e caracteres especiais, mantém alfanumérico + hífens.
 * Ex: "LT 1100 / promo" → "LT-1100-promo"
 */
export function sanitizeRetailerId(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Retorna data atual no fuso BRT (GMT-3) como { dmShort: "20/05", dmId: "20-05" }. */
function brtDayMonth(now: Date = new Date()): { dmShort: string; dmId: string } {
  // toLocaleString com timezone garante DST/UTC handling correto
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
  }).formatToParts(now);
  const dd = parts.find((p) => p.type === 'day')?.value ?? '00';
  const mm = parts.find((p) => p.type === 'month')?.value ?? '00';
  return { dmShort: `${dd}/${mm}`, dmId: `${dd}-${mm}` };
}

// ────────────────────────────────────────────────────────────────────────────
// API: criar produto + product set
// ────────────────────────────────────────────────────────────────────────────

/**
 * Cria um produto no catálogo e em seguida um product set com filtro
 * retailer_id == produto criado. Operação atômica do ponto de vista do
 * caller — se o product set falha, NÃO removemos o produto (deixar pro
 * usuário decidir; produtos órfãos não causam dano e podem ser
 * referenciados em outro set depois).
 */
export async function createProductWithSet(input: CreateProductInput): Promise<CreateProductResult> {
  const tokenInfo = await resolveCatalogToken(input.catalogId);
  if (!tokenInfo) {
    throw new MetaCatalogApiError(
      'resolveToken',
      'NO_TOKEN',
      `Nenhum token Meta com acesso ao catálogo ${input.catalogId}. Rode o sync de catálogos antes.`,
    );
  }
  return createProductWithSetUsingToken(input, tokenInfo.token);
}

/**
 * Igual a createProductWithSet, mas recebe o token diretamente em vez de
 * resolvê-lo via tabela `meta_catalogs`. Útil pra catálogos recém-criados
 * que ainda não foram sincronizados no banco.
 */
export async function createProductWithSetUsingToken(
  input: CreateProductInput,
  token: string,
): Promise<CreateProductResult> {
  const { catalogId, adName, productName: productNameInput, preset } = input;

  const adNameTrim = adName.trim();
  if (!adNameTrim) throw new MetaCatalogApiError('validate', 'INVALID_INPUT', 'Nome do anúncio vazio');

  const productName = productNameInput.trim();
  if (!productName) throw new MetaCatalogApiError('validate', 'INVALID_INPUT', 'Título do produto vazio');

  // Formato do retailer_id: "<nome_do_ad> <dd>/<mm>" (ex: "LT1100 20/05")
  // Preservamos o nome do anúncio sem sanitização (dots/etc. são permitidos
  // pela Meta em retailer_id), apenas trim.
  const { dmShort } = brtDayMonth();
  const retailerId = `${adNameTrim} ${dmShort}`;

  // 1) Cria o produto
  // A Meta exige `price` como INTEIRO em centavos (minor unit da moeda) +
  // `currency` separado como ISO-3. Ex: 10.00 BRL → price=1000, currency=BRL.
  // Aceita "10.00" e "10,00" (formato BR).
  const normalizedPrice = preset.price.replace(',', '.').trim();
  const priceNum = Number(normalizedPrice);
  if (!isFinite(priceNum) || priceNum < 0) {
    throw new MetaCatalogApiError('validate', 'INVALID_PRICE', `Preço inválido: "${preset.price}"`);
  }
  const priceCents = Math.round(priceNum * 100);

  const product = await postGraph<{ id: string }>(
    `${catalogId}/products`,
    {
      retailer_id: retailerId,
      name: productName,
      description: preset.description,
      url: preset.link,
      image_url: preset.image_url,
      price: priceCents,
      currency: preset.currency,
      brand: preset.brand,
      availability: preset.availability,
      condition: preset.condition,
    },
    token,
    'createProduct',
  );

  // 2) Cria o product set com nome = retailer_id (per request do usuário).
  // Usa retry com backoff por causa do subcode 1798130 (empty set) — a Meta
  // pode levar alguns segundos para indexar o produto recém-criado.
  const set = await createProductSetWithRetry(catalogId, retailerId, retailerId, token);

  return {
    product_id: product.id,
    product_set_id: set.id,
    retailer_id: retailerId,
    product_name: productName,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Presets (CRUD no Postgres) — JSONB, upsert por name
// ────────────────────────────────────────────────────────────────────────────

export interface CatalogProductPreset {
  id: number;
  name: string;
  config: ProductPresetConfig;
  created_at: string;
  updated_at: string;
}

export async function ensurePresetsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS catalog_product_presets (
      id         SERIAL PRIMARY KEY,
      name       VARCHAR(255) NOT NULL UNIQUE,
      config     JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function listPresets(): Promise<CatalogProductPreset[]> {
  await ensurePresetsTable();
  const { rows } = await pool.query(
    `SELECT id, name, config, created_at, updated_at
       FROM catalog_product_presets
      ORDER BY name ASC`,
  );
  return rows as CatalogProductPreset[];
}

export async function upsertPreset(name: string, config: ProductPresetConfig): Promise<CatalogProductPreset> {
  await ensurePresetsTable();
  const { rows } = await pool.query(
    `INSERT INTO catalog_product_presets (name, config)
          VALUES ($1, $2::jsonb)
     ON CONFLICT (name) DO UPDATE
          SET config = EXCLUDED.config,
              updated_at = NOW()
      RETURNING id, name, config, created_at, updated_at`,
    [name, JSON.stringify(config)],
  );
  return rows[0] as CatalogProductPreset;
}

export async function deletePreset(idOrName: { id?: number; name?: string }): Promise<void> {
  await ensurePresetsTable();
  if (idOrName.id) {
    await pool.query(`DELETE FROM catalog_product_presets WHERE id = $1`, [idOrName.id]);
  } else if (idOrName.name) {
    await pool.query(`DELETE FROM catalog_product_presets WHERE name = $1`, [idOrName.name]);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Snapshot de produtos do catálogo + lista de ignorados
// ────────────────────────────────────────────────────────────────────────────

export interface CatalogProductRow {
  product_id: string;
  retailer_id: string | null;
  name: string | null;
  url: string | null;
  image_url: string | null;
  videos: Array<{ url: string; tag?: string }>;
  updated_at: string;
}

export async function ensureCatalogProductsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS meta_catalog_products (
      catalog_id   TEXT NOT NULL,
      product_id   TEXT NOT NULL,
      retailer_id  TEXT,
      name         TEXT,
      url          TEXT,
      image_url    TEXT,
      videos       JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (catalog_id, product_id)
    )
  `);
}

export async function ensureIgnoredProductsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS catalog_ignored_products (
      catalog_id   TEXT NOT NULL,
      product_id   TEXT NOT NULL,
      retailer_id  TEXT,
      name         TEXT,
      ignored_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (catalog_id, product_id)
    )
  `);
}

/**
 * Pagina todos os produtos do catálogo na Graph API e devolve a lista
 * crua (id, retailer_id, name, url, image_url, video[]).
 *
 * Cada item de `video[]` na Meta vem como `{ url, tag }`. Mantemos o array
 * completo no snapshot pra distinguir "sem vídeo" de "tem vídeo com tag X".
 */
async function fetchAllCatalogProducts(catalogId: string, token: string): Promise<{
  items: any[];
  pageCount: number;
  firstPageKeys: string[];
  sampleProductKeys: string[];
  sampleProduct: any;
}> {
  // Pedimos vários candidatos: `video` (singular, doc oficial) e `videos`
  // (plural, aparece em alguns endpoints/versões). O processamento downstream
  // pega o primeiro que vier com dados.
  const fields = 'id,retailer_id,name,url,image_url,video,videos';
  let nextUrl: string | null =
    `${GRAPH}/${catalogId}/products?fields=${encodeURIComponent(fields)}&limit=200&access_token=${token}`;
  const out: any[] = [];
  let pageCount = 0;
  let firstPageKeys: string[] = [];
  let sampleProduct: any = null;
  let sampleProductKeys: string[] = [];
  while (nextUrl) {
    const res = await fetch(nextUrl);
    const data: any = await res.json().catch(() => ({}));
    if (data?.error) {
      throw new MetaCatalogApiError('listProducts', data.error.code, buildMetaErrorMessage(data.error), data.error);
    }
    if (pageCount === 0) {
      firstPageKeys = Object.keys(data ?? {});
      if (Array.isArray(data?.data) && data.data[0]) {
        sampleProduct = data.data[0];
        sampleProductKeys = Object.keys(sampleProduct);
      }
    }
    if (Array.isArray(data?.data)) {
      out.push(...data.data);
      pageCount++;
    } else {
      break;
    }
    nextUrl = data?.paging?.next ?? null;
  }
  console.log(`[meta-product-catalogs] catalog ${catalogId}: ${out.length} produtos em ${pageCount} páginas (firstPageKeys=${firstPageKeys.join(',')} · sampleKeys=${sampleProductKeys.join(',')})`);
  if (sampleProduct) {
    console.log(`[meta-product-catalogs] sample product:`, JSON.stringify(sampleProduct).slice(0, 500));
  }
  return { items: out, pageCount, firstPageKeys, sampleProductKeys, sampleProduct };
}

/**
 * Extrai a lista de vídeos de um produto cru retornado pela Graph API.
 *
 * A Meta pode devolver:
 *  - `video: [{url, tag}, ...]`           (array direto, raro)
 *  - `video: {data: [...]}`               (edge connection)
 *  - `videos: [...]` ou `videos: {data}`  (plural, em algumas versões)
 *  - `video_urls: ["...", "..."]`         (formato de feed, strings cruas)
 *
 * Normaliza tudo para `[{url, tag?}, ...]`.
 */
function extractVideos(p: any): Array<{ url: string; tag?: string }> {
  const candidates: any[] = [];
  for (const key of ['video', 'videos']) {
    const v = p?.[key];
    if (!v) continue;
    if (Array.isArray(v)) candidates.push(...v);
    else if (Array.isArray(v.data)) candidates.push(...v.data);
  }
  if (Array.isArray(p?.video_urls)) {
    for (const u of p.video_urls) if (typeof u === 'string') candidates.push({ url: u });
  }
  return candidates
    .filter((v: any) => v && typeof v.url === 'string' && v.url.trim() !== '')
    .map((v: any) => ({ url: String(v.url), tag: v.tag ? String(v.tag) : undefined }));
}

export interface CatalogProductStats {
  total: number;
  with_video: number;
  without_video: number;
  ignored: number;
}

/** Conta produtos do snapshot por categoria (total / com vídeo / sem vídeo / ignorados). */
export async function getCatalogProductStats(catalogId: string): Promise<CatalogProductStats> {
  await ensureCatalogProductsTable();
  await ensureIgnoredProductsTable();
  const { rows } = await pool.query(
    `SELECT
       COUNT(*)::int                                                                         AS total,
       COUNT(*) FILTER (WHERE jsonb_array_length(videos) > 0)::int                           AS with_video,
       COUNT(*) FILTER (WHERE jsonb_array_length(videos) = 0)::int                           AS without_video,
       (SELECT COUNT(*)::int FROM catalog_ignored_products WHERE catalog_id = $1)            AS ignored
       FROM meta_catalog_products
      WHERE catalog_id = $1`,
    [catalogId],
  );
  const r = rows[0] ?? {};
  return {
    total: r.total ?? 0,
    with_video: r.with_video ?? 0,
    without_video: r.without_video ?? 0,
    ignored: r.ignored ?? 0,
  };
}

/**
 * Sincroniza o snapshot de produtos do catálogo no Postgres. Apaga produtos
 * que sumiram da Meta (filtrando por updated_at < syncStart).
 *
 * `video` na Meta pode vir como array direto OU como conexão `{data: [...]}`
 * dependendo do fields= usado. Normalizamos para array simples.
 */
export async function syncCatalogProducts(catalogId: string): Promise<{
  count: number;
  raw_count: number;
  profile_used: string;
  page_count: number;
  first_page_keys: string[];
  sample_product_keys: string[];
  sample_videos: Array<{ url: string; tag?: string }>;
}> {
  await ensureCatalogProductsTable();

  const tokenInfo = await resolveCatalogToken(catalogId);
  if (!tokenInfo) {
    throw new MetaCatalogApiError(
      'resolveToken',
      'NO_TOKEN',
      `Nenhum token Meta com acesso ao catálogo ${catalogId}. Rode o sync de catálogos antes.`,
    );
  }

  const rawResp = await fetchAllCatalogProducts(catalogId, tokenInfo.token);
  const raw = rawResp.items;
  const syncStart = new Date();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const p of raw) {
      const videos = extractVideos(p);

      await client.query(
        `INSERT INTO meta_catalog_products
           (catalog_id, product_id, retailer_id, name, url, image_url, videos, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb, now())
         ON CONFLICT (catalog_id, product_id) DO UPDATE SET
           retailer_id = EXCLUDED.retailer_id,
           name        = EXCLUDED.name,
           url         = EXCLUDED.url,
           image_url   = EXCLUDED.image_url,
           videos      = EXCLUDED.videos,
           updated_at  = now()`,
        [
          catalogId,
          p.id,
          p.retailer_id ?? null,
          p.name ?? null,
          p.url ?? null,
          p.image_url ?? null,
          JSON.stringify(videos),
        ],
      );
    }
    await client.query(
      `DELETE FROM meta_catalog_products WHERE catalog_id = $1 AND updated_at < $2`,
      [catalogId, syncStart],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return {
    count: raw.length,
    raw_count: raw.length,
    profile_used: tokenInfo.profileName,
    page_count: rawResp.pageCount,
    first_page_keys: rawResp.firstPageKeys,
    sample_product_keys: rawResp.sampleProductKeys,
    sample_videos: rawResp.sampleProduct ? extractVideos(rawResp.sampleProduct) : [],
  };
}

/**
 * Lista produtos do catálogo a partir do snapshot.
 *  - `missingVideo: true` filtra produtos com `videos` vazio
 *  - Ignorados (em `catalog_ignored_products`) ficam de fora.
 */
export async function listCatalogProducts(
  catalogId: string,
  opts: { missingVideo?: boolean } = {},
): Promise<CatalogProductRow[]> {
  await ensureCatalogProductsTable();
  await ensureIgnoredProductsTable();
  const conds = ['p.catalog_id = $1'];
  if (opts.missingVideo) conds.push(`(p.videos = '[]'::jsonb OR jsonb_array_length(p.videos) = 0)`);
  const { rows } = await pool.query(
    `SELECT p.product_id, p.retailer_id, p.name, p.url, p.image_url, p.videos, p.updated_at
       FROM meta_catalog_products p
       LEFT JOIN catalog_ignored_products i
         ON i.catalog_id = p.catalog_id AND i.product_id = p.product_id
      WHERE ${conds.join(' AND ')}
        AND i.product_id IS NULL
      ORDER BY p.retailer_id NULLS LAST, p.product_id`,
    [catalogId],
  );
  return rows.map((r: any) => ({
    product_id: r.product_id,
    retailer_id: r.retailer_id,
    name: r.name,
    url: r.url,
    image_url: r.image_url,
    videos: Array.isArray(r.videos) ? r.videos : [],
    updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  }));
}

export interface IgnoredProductRow {
  product_id: string;
  retailer_id: string | null;
  name: string | null;
  ignored_at: string;
}

export async function listIgnoredProducts(catalogId: string): Promise<IgnoredProductRow[]> {
  await ensureIgnoredProductsTable();
  const { rows } = await pool.query(
    `SELECT product_id, retailer_id, name, ignored_at
       FROM catalog_ignored_products
      WHERE catalog_id = $1
      ORDER BY ignored_at DESC`,
    [catalogId],
  );
  return rows.map((r: any) => ({
    product_id: r.product_id,
    retailer_id: r.retailer_id,
    name: r.name,
    ignored_at: r.ignored_at instanceof Date ? r.ignored_at.toISOString() : String(r.ignored_at),
  }));
}

export async function ignoreProduct(
  catalogId: string,
  productId: string,
  meta: { retailerId?: string | null; name?: string | null } = {},
): Promise<void> {
  await ensureIgnoredProductsTable();
  await pool.query(
    `INSERT INTO catalog_ignored_products (catalog_id, product_id, retailer_id, name)
          VALUES ($1, $2, $3, $4)
     ON CONFLICT (catalog_id, product_id) DO NOTHING`,
    [catalogId, productId, meta.retailerId ?? null, meta.name ?? null],
  );
}

export async function unignoreProduct(catalogId: string, productId: string): Promise<void> {
  await ensureIgnoredProductsTable();
  await pool.query(
    `DELETE FROM catalog_ignored_products WHERE catalog_id = $1 AND product_id = $2`,
    [catalogId, productId],
  );
}

/**
 * Verifica vídeos de um produto. Tenta 3 endpoints em ordem:
 *   1. GET /{product_id}?fields=id,retailer_id,video — singular, só `video`
 *      (não `videos`, que dispara #100 nonexisting field no singular).
 *   2. GET /{catalog_id}/products?filter={retailer_id:eq:X} — usa retailer_id,
 *      que é o filter que funciona pro createProductSet (mesmo padrão).
 *   3. GET /{catalog_id}/products?filter={id:eq:X} — fallback por product_id.
 *
 * Devolve `source` indicando qual endpoint achou.
 */
async function fetchProductVideosFromCatalog(
  catalogId: string,
  productId: string,
  token: string,
  retailerId?: string,
): Promise<{ videos: Array<{ url: string; tag?: string }>; rawKeys: string[]; found: boolean; source: string }> {
  // Endpoint 1: singular /{product_id}?fields=video
  try {
    const url = `${GRAPH}/${productId}?fields=id,retailer_id,video&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    const data: any = await res.json().catch(() => ({}));
    if (!data?.error) {
      return {
        videos: extractVideos(data),
        rawKeys: Object.keys(data ?? {}),
        found: !!data?.id,
        source: 'singular',
      };
    }
  } catch {/* fallback */}

  // Endpoint 2: catalog/products com filter por retailer_id (formato comprovado)
  if (retailerId) {
    try {
      const filter = JSON.stringify({ retailer_id: { eq: retailerId } });
      const url =
        `${GRAPH}/${catalogId}/products?fields=id,retailer_id,video,videos` +
        `&filter=${encodeURIComponent(filter)}&limit=1` +
        `&access_token=${encodeURIComponent(token)}`;
      const res = await fetch(url);
      const data: any = await res.json().catch(() => ({}));
      if (!data?.error) {
        const first = Array.isArray(data?.data) ? data.data[0] : null;
        if (first) {
          return {
            videos: extractVideos(first),
            rawKeys: Object.keys(first),
            found: true,
            source: 'catalog_filter_retailer',
          };
        }
      }
    } catch {/* fallback */}
  }

  // Endpoint 3: catalog/products com filter por id
  const filter = JSON.stringify({ id: { eq: productId } });
  const url2 =
    `${GRAPH}/${catalogId}/products?fields=id,retailer_id,video,videos` +
    `&filter=${encodeURIComponent(filter)}&limit=1` +
    `&access_token=${encodeURIComponent(token)}`;
  const res2 = await fetch(url2);
  const data2: any = await res2.json().catch(() => ({}));
  if (data2?.error) {
    throw new MetaCatalogApiError('verifyProductVideo', data2.error.code, buildMetaErrorMessage(data2.error), data2.error);
  }
  const first = Array.isArray(data2?.data) ? data2.data[0] : null;
  return {
    videos: first ? extractVideos(first) : [],
    rawKeys: first ? Object.keys(first) : [],
    found: !!first,
    source: 'catalog_filter_id',
  };
}

/**
 * Faz polling no check_batch_request_status até o handle terminar ou timeout.
 *
 * items_batch processa async; o handle volta imediatamente mas o produto
 * só reflete a mudança depois do batch ser executado (~1-5s típico).
 */
async function pollBatchHandle(
  catalogId: string,
  handle: string,
  token: string,
): Promise<{ status: string; errors_count: number; raw: any }> {
  const delays = [600, 1000, 1500, 2000, 3000, 4000, 5000]; // ~17s no pior caso
  const TERMINAL = new Set(['finished', 'failed', 'success', 'complete', 'completed', 'done', 'error']);
  let lastItem: any = null;
  for (let i = 0; i < delays.length; i++) {
    await sleep(delays[i]);
    const url =
      `${GRAPH}/${catalogId}/check_batch_request_status` +
      `?handles=${encodeURIComponent(JSON.stringify([handle]))}` +
      `&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    const data: any = await res.json().catch(() => ({}));
    const item = data?.data?.[0];
    if (item) lastItem = item;
    if (item && typeof item.status === 'string' && TERMINAL.has(item.status.toLowerCase())) {
      return { status: item.status, errors_count: item.errors_count ?? 0, raw: item };
    }
  }
  // Timeout — devolve o último status visto (geralmente in_progress)
  return {
    status: lastItem?.status ?? 'timeout',
    errors_count: lastItem?.errors_count ?? 0,
    raw: lastItem,
  };
}

/**
 * Atualiza a URL de vídeo do produto na Meta via items_batch + tenta múltiplos
 * field names em sequência (o nome certo varia entre versões/contextos da API).
 *
 * Field-name candidates testados em ordem:
 *  - `video_link`             — string (formato XML feed `<g:video_link>`)
 *  - `additional_video_urls`  — array de strings
 *  - `video`                  — array `[{url, tag}]` (formato CSV feed `video[0].url`)
 *  - `videos`                 — array (plural, observado em algumas versões)
 *
 * Para cada strategy:
 *  1. POST items_batch com o field name dela.
 *  2. Se o POST retornar #100 "nonexisting field", segue pra próxima.
 *  3. Se aceitar, poll do handle até concluir.
 *  4. GET do produto pra confirmar que o vídeo aparece (com retry 2s).
 *  5. Se confirmou, atualiza snapshot e retorna.
 *
 * Se nenhuma strategy funcionar, retorna erro detalhado com o resultado de cada.
 */
export async function updateProductVideo(
  catalogId: string,
  productId: string,
  videoUrl: string,
): Promise<{
  videos: Array<{ url: string; tag?: string }>;
  retailer_id: string;
  strategy_used: string;
  attempts: Array<{ strategy: string; post_error?: string; batch_handle?: string | null; poll_status?: string; verify_videos?: number }>;
}> {
  const trimmed = videoUrl.trim();
  if (!trimmed) {
    throw new MetaCatalogApiError('validate', 'INVALID_INPUT', 'video_url vazio');
  }
  try { new URL(trimmed); } catch {
    throw new MetaCatalogApiError('validate', 'INVALID_URL', `video_url inválido: "${trimmed}"`);
  }

  const tokenInfo = await resolveCatalogToken(catalogId);
  if (!tokenInfo) {
    throw new MetaCatalogApiError(
      'resolveToken',
      'NO_TOKEN',
      `Nenhum token Meta com acesso ao catálogo ${catalogId}.`,
    );
  }
  const token = tokenInfo.token;

  // items_batch precisa de retailer_id; lookup no snapshot
  await ensureCatalogProductsTable();
  const { rows } = await pool.query(
    `SELECT retailer_id FROM meta_catalog_products WHERE catalog_id = $1 AND product_id = $2`,
    [catalogId, productId],
  );
  const retailerId = rows[0]?.retailer_id as string | null;
  if (!retailerId) {
    throw new MetaCatalogApiError(
      'lookup',
      'NO_RETAILER_ID',
      `Sem retailer_id no snapshot para produto ${productId}. Rode "Sincronizar Meta" antes.`,
    );
  }

  // `video` é o field correto na Meta. Tags inválidas fazem a Meta aceitar
  // o batch mas descartar silenciosamente o vídeo — por isso enviamos só
  // `{url}` sem tag. As outras 3 strategies ficam como fallback caso a
  // Meta mude o nome do field em alguma versão futura.
  const strategies: Array<{ key: string; data: Record<string, unknown> }> = [
    { key: 'video',                 data: { video: [{ url: trimmed }] } },
    { key: 'video_link',            data: { video_link: trimmed } },
    { key: 'additional_video_urls', data: { additional_video_urls: [trimmed] } },
    { key: 'videos',                data: { videos: [{ url: trimmed }] } },
  ];

  const attempts: Array<{
    strategy: string;
    post_error?: string;
    batch_handle?: string | null;
    batch_resp_keys?: string[];
    batch_resp_sample?: string;
    poll_status?: string;
    verify_videos?: number;
    verify_source?: string;
  }> = [];

  for (const s of strategies) {
    const attempt: typeof attempts[number] = { strategy: s.key };
    let batchResp: any = null;
    try {
      batchResp = await postGraph<any>(
        `${catalogId}/items_batch`,
        {
          item_type: 'PRODUCT_ITEM',
          allow_upsert: true,
          validate_only: false,
          // `id` é o retailer_id do produto, COLOCADO DENTRO DE `data`
          // (não como `retailer_id` no nível do request). A Meta retorna
          // "Can not find required field id" se estiver no lugar errado.
          requests: [{ method: 'UPDATE', data: { id: retailerId, ...s.data } }],
        },
        token,
        `updateProductVideo:${s.key}`,
      );
    } catch (err: any) {
      attempt.post_error = err?.message ?? String(err);
      attempts.push(attempt);
      continue; // strategy não aceita → tenta próxima
    }

    attempt.batch_resp_keys = batchResp && typeof batchResp === 'object' ? Object.keys(batchResp) : [];
    attempt.batch_resp_sample = JSON.stringify(batchResp ?? null).slice(0, 600);
    console.log(`[meta-product-catalogs] items_batch ${s.key} response:`, attempt.batch_resp_sample);

    // Se a Meta marcou o field como "não reconhecido" via warning, essa
    // strategy está usando o nome errado — pula sem esperar verify.
    const validation = batchResp?.validation_status?.[0];
    const warnings: any[] = Array.isArray(validation?.warnings) ? validation.warnings : [];
    const unrecognized = warnings.some(
      (w) =>
        typeof w?.message === 'string' &&
        /n[ãa]o reconhecido|unrecognized field|not recognized/i.test(w.message),
    );
    if (unrecognized) {
      attempt.post_error = `field_not_recognized:${s.key}`;
      attempts.push(attempt);
      continue;
    }

    const handle = batchResp?.handles?.[0] ?? null;
    attempt.batch_handle = handle;
    if (handle) {
      try {
        const poll = await pollBatchHandle(catalogId, handle, token);
        const rawSample = poll.raw ? `|raw=${JSON.stringify(poll.raw).slice(0, 300)}` : '';
        attempt.poll_status = `${poll.status}/errors:${poll.errors_count}${rawSample}`;
      } catch (err: any) {
        attempt.poll_status = `poll_error:${err?.message ?? String(err)}`;
      }
    }

    // Verify (com 2 retries, sleep escalado — Meta às vezes demora vários
    // segundos pra propagar updates em produtos individuais).
    let verifyVideos: Array<{ url: string; tag?: string }> = [];
    let verifyFound = false;
    let verifySource = '';
    try {
      // Janela total ~25s — items_batch async pode demorar 10-20s pra
      // propagar no read mesmo com handle retornado e poll finished.
      const delays = [0, 2000, 3000, 5000, 8000, 7000];
      for (const d of delays) {
        if (d > 0) await sleep(d);
        const verify = await fetchProductVideosFromCatalog(catalogId, productId, token, retailerId);
        verifyVideos = verify.videos;
        verifyFound = verify.found;
        verifySource = verify.source;
        if (verifyVideos.some((v) => v.url === trimmed)) break;
      }
    } catch (err: any) {
      attempt.post_error = `verify_error:${err?.message ?? String(err)}`;
    }
    attempt.verify_videos = verifyVideos.length;
    attempt.verify_source = verifySource;
    // Anota se o produto sequer foi encontrado pelo verify — distingue
    // "produto não encontrado" de "encontrado mas sem o vídeo".
    if (!verifyFound) attempt.poll_status = (attempt.poll_status ?? '') + '/not_found_in_verify';
    attempts.push(attempt);

    if (verifyVideos.some((v) => v.url === trimmed)) {
      await pool.query(
        `UPDATE meta_catalog_products
            SET videos = $1::jsonb, updated_at = now()
          WHERE catalog_id = $2 AND product_id = $3`,
        [JSON.stringify(verifyVideos), catalogId, productId],
      );
      return {
        videos: verifyVideos,
        retailer_id: retailerId,
        strategy_used: s.key,
        attempts,
      };
    }
    // Aceitou o POST mas não persistiu — pode ter sido descartado silenciosamente.
    // Tenta próxima strategy.
  }

  console.error('[meta-product-catalogs] updateProductVideo: nenhuma strategy funcionou', JSON.stringify({ retailerId, productId, attempts }));
  const summary = attempts
    .map((a) => {
      if (a.post_error) return `${a.strategy}:POST_ERR(${a.post_error.slice(0, 60)})`;
      const sample = a.batch_resp_sample ? ` raw=${a.batch_resp_sample}` : '';
      const poll = a.poll_status ? ` poll=${a.poll_status}` : '';
      const src = a.verify_source ? ` src=${a.verify_source}` : '';
      return `${a.strategy}:${a.verify_videos ?? 0}vid${sample}${poll}${src}`;
    })
    .join(' · ');
  throw new MetaCatalogApiError(
    'updateProductVideo',
    'NOT_PERSISTED',
    `Nenhum field name de vídeo foi aceito ou persistido para retailer_id="${retailerId}" (product_id=${productId}). Tentativas: ${summary}`,
    { retailerId, productId, attempts },
  );
}
