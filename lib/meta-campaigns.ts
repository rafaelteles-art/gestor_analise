/**
 * Meta Marketing API — criação de campanhas de conversão de website.
 *
 * Hierarquia (Graph API v21.0):
 *   Campaign → AdSet → AdCreative → Ad
 *
 * Refs oficiais:
 *  - Create campaign:        https://developers.facebook.com/docs/marketing-api/get-started/basic-ad-creation/create-an-ad-campaign/
 *  - Ad Set / promoted_object: https://developers.facebook.com/docs/marketing-api/reference/ad-promoted-object
 *  - Ad Creative / Object Story Spec: https://developers.facebook.com/docs/marketing-api/reference/ad-creative-object-story-spec/
 *  - Lookalike Audiences:    https://developers.facebook.com/docs/marketing-api/audiences/guides/lookalike-audiences/
 */

export const META_API_VERSION = 'v21.0';
const GRAPH = `https://graph.facebook.com/${META_API_VERSION}`;

// ────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ────────────────────────────────────────────────────────────────────────────

export type CampaignObjective =
  | 'OUTCOME_SALES'
  | 'OUTCOME_LEADS'
  | 'OUTCOME_TRAFFIC'
  | 'OUTCOME_ENGAGEMENT'
  | 'OUTCOME_AWARENESS'
  | 'OUTCOME_APP_PROMOTION'
  /** DPA (catálogo). Para vendas, costuma pedir promoted_object com catalog_id. */
  | 'PRODUCT_CATALOG_SALES';

export type SpecialAdCategory =
  | 'NONE'
  | 'EMPLOYMENT'
  | 'HOUSING'
  | 'CREDIT'
  | 'ISSUES_ELECTIONS_POLITICS'
  | 'ONLINE_GAMBLING_AND_GAMING'
  | 'FINANCIAL_PRODUCTS_SERVICES';

export type AdStatus = 'ACTIVE' | 'PAUSED';

export type OptimizationGoal =
  | 'OFFSITE_CONVERSIONS'
  | 'LANDING_PAGE_VIEWS'
  | 'LINK_CLICKS'
  | 'IMPRESSIONS'
  | 'REACH'
  | 'VALUE'
  | 'THRUPLAY';

export type BillingEvent = 'IMPRESSIONS' | 'LINK_CLICKS' | 'THRUPLAY';

export type BidStrategy =
  | 'LOWEST_COST_WITHOUT_CAP'
  | 'LOWEST_COST_WITH_BID_CAP'
  | 'COST_CAP'
  | 'LOWEST_COST_WITH_MIN_ROAS';

export type CustomEventType =
  | 'PURCHASE'
  | 'LEAD'
  | 'COMPLETE_REGISTRATION'
  | 'ADD_TO_CART'
  | 'INITIATE_CHECKOUT'
  | 'ADD_PAYMENT_INFO'
  | 'CONTENT_VIEW'
  | 'SUBSCRIBE'
  | 'START_TRIAL'
  | 'OTHER';

export type CallToActionType =
  | 'SHOP_NOW'
  | 'LEARN_MORE'
  | 'SIGN_UP'
  | 'SUBSCRIBE'
  | 'DOWNLOAD'
  | 'GET_OFFER'
  | 'BOOK_TRAVEL'
  | 'CONTACT_US'
  | 'APPLY_NOW'
  | 'BUY_NOW'
  | 'GET_QUOTE'
  | 'ORDER_NOW';

export interface PromotedObject {
  pixel_id?: string;
  custom_event_type?: CustomEventType;
  /** Catálogo (DPA). Obrigatório quando a campanha é PRODUCT_CATALOG_SALES. */
  product_catalog_id?: string;
  /** Conjunto de produtos dentro do catálogo. Opcional — sem isso usa o catálogo inteiro. */
  product_set_id?: string;
}

export interface Targeting {
  geo_locations: {
    countries?: string[];
    cities?: { key: string; radius?: number; distance_unit?: 'mile' | 'kilometer' }[];
    regions?: { key: string }[];
  };
  age_min?: number;
  age_max?: number;
  /** 1 = male, 2 = female; omitir = todos */
  genders?: number[];
  /** IDs de Custom/Saved Audiences */
  custom_audiences?: { id: string }[];
  excluded_custom_audiences?: { id: string }[];
  publisher_platforms?: ('facebook' | 'instagram' | 'audience_network' | 'messenger')[];
  facebook_positions?: string[];
  instagram_positions?: string[];
  flexible_spec?: Array<{ interests?: { id: string; name?: string }[] }>;
  locales?: number[];
  /** 'mobile' / 'desktop' — quando ausente, Meta inclui ambos. */
  device_platforms?: ('mobile' | 'desktop')[];
  /** Apenas Wi-Fi (filtra connection_type para ['WIFI']). */
  user_device?: string[];
  user_os?: string[];
  wireless_carrier?: string[];
  connection_type?: ('WIFI' | '2G' | '3G' | '4G' | '5G')[];
  /**
   * Advantage+ Audience (relaxação de targeting): a Meta pode expandir
   * idade, localização, interesses, etc. ['lookalike','custom_audience','interest']
   * habilita expansão em todos os eixos. Quando omitido, sem relaxação.
   */
  targeting_relaxation_types?: { lookalike?: 0 | 1; custom_audience?: 0 | 1 };
}

export interface ChildAttachment {
  link: string;
  name?: string;
  description?: string;
  image_hash: string;
  call_to_action?: { type: CallToActionType; value: { link: string } };
}

export interface CreativeSpec {
  name: string;
  page_id: string;
  instagram_actor_id?: string;
  /** "single" → uma imagem ou vídeo; "carousel" → 2-10 child_attachments; "dpa" → template DPA */
  type: 'single' | 'carousel' | 'dpa';
  /** ── single ── */
  link?: string;
  message?: string;
  headline?: string;
  description?: string;
  /** Para vídeo: image_hash é dispensável; usamos video_id + image_url (thumbnail). */
  image_hash?: string;
  /** Quando setado, o creative é montado com `video_data` em vez de `link_data`. */
  video_id?: string;
  /** URL da miniatura do vídeo (obrigatório no video_data quando não há image_hash). */
  video_thumbnail_url?: string;
  cta_type?: CallToActionType;
  cta_link?: string;
  /** ── carousel ── */
  child_attachments?: ChildAttachment[];
  /** forçar ordem dos cards do carrossel (true = manual) */
  multi_share_optimized?: boolean;
  /** ── DPA / catálogo ──
   * Quando type='dpa' usa template_data e product_set_id, e suporta tokens
   * `{{product.name}}`, `{{product.price}}`, etc. nos textos.
   */
  product_set_id?: string;
  template_link?: string;
  /**
   * URL params (Meta `url_tags`). Aceita variáveis Meta intactas
   * (`{{campaign.id}}`, etc.) — substituídas na entrega. Variáveis DirectAds
   * já vêm resolvidas pelo orquestrador antes de chegar aqui.
   */
  url_tags?: string;
  /**
   * Advantage+ Creative — quais "creative features" a Meta pode aplicar.
   * Cada chave segue { enroll_status: 'OPT_IN' | 'OPT_OUT' }.
   */
  advantage_creative_features?: Record<string, 'OPT_IN' | 'OPT_OUT'>;
  /** Multi-Advertiser Ads — anúncio pode aparecer ao lado de outros anunciantes. */
  multi_advertiser?: boolean;
}

export interface AdSpec {
  name: string;
  creative: CreativeSpec;
}

export interface CampaignSpec {
  name: string;
  objective: CampaignObjective;
  status: AdStatus;
  special_ad_categories: SpecialAdCategory[];
  /** orçamento opcional no nível da campanha (em centavos da moeda da conta) */
  daily_budget_cents?: number;
  lifetime_budget_cents?: number;
  buying_type?: 'AUCTION' | 'RESERVED';
  /**
   * Advantage Campaign Budget — habilita compartilhamento de até 20% do orçamento
   * entre AdSets. Desde 2024 a Meta exige este campo explícito quando o orçamento
   * NÃO está no nível da campanha (i.e. está no AdSet). Default `false` espelha
   * o Ads Manager quando o usuário não ativa CBO.
   */
  is_adset_budget_sharing_enabled?: boolean;
  /** bid_strategy só faz sentido aqui quando há orçamento de campanha (CBO). */
  bid_strategy?: BidStrategy;
  /** limite total que a campanha pode gastar (centavos). */
  spend_cap_cents?: number;
  /**
   * Catálogo associado à campanha (DPA com "Nível de Campanha"). Quando setado,
   * o creative pode omitir product_set_id e a Meta usa o catálogo da campanha.
   */
  promoted_object?: { product_catalog_id: string };
}

export interface AdSetSpec {
  name: string;
  optimization_goal: OptimizationGoal;
  billing_event: BillingEvent;
  bid_strategy?: BidStrategy;
  /** centavos da moeda da conta */
  daily_budget_cents?: number;
  lifetime_budget_cents?: number;
  /** centavos — usado quando bid_strategy = LOWEST_COST_WITH_BID_CAP/COST_CAP */
  bid_amount_cents?: number;
  promoted_object: PromotedObject;
  targeting: Targeting;
  destination_type?: 'WEBSITE' | 'APP' | 'MESSENGER' | 'WHATSAPP';
  /** ISO 8601 com timezone, ex: 2025-01-15T15:00:00-03:00 */
  start_time?: string;
  end_time?: string;
  status: AdStatus;
  attribution_spec?: { event_type: 'CLICK_THROUGH' | 'VIEW_THROUGH'; window_days: 1 | 7 }[];
}

export interface CreateFullCampaignInput {
  account_id: string; // formato act_<id>
  access_token: string;
  campaign: CampaignSpec;
  adset: AdSetSpec;
  ads: AdSpec[];
}

/**
 * Input do orquestrador batch (multiplicador): para cada criativo desenhado
 * pelo usuário, cria N campanhas × M conjuntos × K anúncios.
 *
 * Os "templates" descrevem a unidade base; o orquestrador aplica sufixos
 * deterministas (_C01, _CJ01, _AD01) e distribui páginas em round-robin
 * entre as cópias de cada conjunto.
 */
export interface BatchCreateInput {
  account_id: string;
  access_token: string;
  /** Quantos campanhas criar por criativo desenhado. */
  campaigns_per_creative: number;
  /** Quantos conjuntos criar por campanha. */
  adsets_per_campaign: number;
  /** Quantos anúncios criar por conjunto (cada ad é uma cópia do criativo). */
  ads_per_adset: number;
  /** Lista de Page IDs disponíveis — distribuídos em round-robin entre os ads. */
  page_ids: string[];
  /** Se ligado, tenta a próxima página em caso de erro no creative. */
  page_auto_retry: boolean;
  /** Template da campanha (name vira prefixo: name_C01, name_C02…). */
  campaign: CampaignSpec;
  /** Template do conjunto (idem prefixo). */
  adset: AdSetSpec;
  /** Um "criativo" por linha — o orquestrador aplica multiplicadores. */
  creatives: { name: string; creative: CreativeSpec }[];
  /**
   * Template de URL tags (utm/etc.). Variáveis DirectAds (`{{conta_nome}}`,
   * `{{criativo}}`, `{{sequencial:XX}}`, …) são substituídas aqui no servidor
   * com o contexto de cada ad. Variáveis Meta (`{{campaign.id}}`, etc.) ficam
   * intactas — a Meta substitui na entrega.
   */
  url_tags_template?: string;
  /** Contexto adicional para resolver variáveis DirectAds. */
  context?: {
    conta_nome?: string;
    conta_apelido?: string;
    conta_id?: string;
    pixel?: string;
    objetivo?: string;
    estrutura?: string;
    pagina?: string;
    catalogo_nome?: string;
    conjunto_de_produtos?: string;
    budget?: string;
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers internos
// ────────────────────────────────────────────────────────────────────────────

class MetaApiError extends Error {
  constructor(public step: string, public fbCode: number | undefined, message: string, public raw?: unknown) {
    super(message);
    this.name = 'MetaApiError';
  }
}

// Constrói uma mensagem rica a partir do objeto error do Meta. Sem isso só
// vemos "Invalid parameter", que é genérico — error_user_title/msg/subcode/
// fbtrace_id é onde mora o diagnóstico real.
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

async function postGraph<T>(path: string, params: Record<string, unknown>, token: string, step: string): Promise<T> {
  const url = `${GRAPH}/${path}`;
  // Meta aceita JSON em campos complexos via form-urlencoded com strings JSON,
  // mas o JSON puro também funciona para a maioria dos endpoints. Usamos form
  // pra evitar surpresas com sub-objetos.
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    body.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  body.append('access_token', token);

  const res = await fetch(url, { method: 'POST', body });
  const data: any = await res.json();
  if (data?.error) {
    throw new MetaApiError(step, data.error.code, buildMetaErrorMessage(data.error), data.error);
  }
  return data as T;
}

async function getGraph<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const u = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set('access_token', token);
  const res = await fetch(u.toString());
  const data: any = await res.json();
  if (data?.error) throw new MetaApiError('GET ' + path, data.error.code, buildMetaErrorMessage(data.error), data.error);
  return data as T;
}

// ────────────────────────────────────────────────────────────────────────────
// Listas auxiliares (para preencher os dropdowns da UI)
// ────────────────────────────────────────────────────────────────────────────

export interface PixelInfo {
  id: string;
  name: string;
  last_fired_time?: string;
}

export async function listPixels(accountId: string, token: string): Promise<PixelInfo[]> {
  const data = await getGraph<{ data: PixelInfo[] }>(
    `${accountId}/adspixels`,
    token,
    { fields: 'id,name,last_fired_time', limit: '100' }
  );
  return data.data ?? [];
}

export interface PageInfo {
  id: string;
  name: string;
  /** token da Page (necessário em alguns casos para preview); aqui só listamos */
  access_token?: string;
  instagram_business_account?: { id: string };
}

/**
 * Cache em memória de `listPages` por (token, bmId). TTL 10 min.
 * Evita re-bater na Meta a cada abertura do dropdown (que dispara erros
 * (#4) Application request limit e (#1) "reduce the amount of data").
 *
 * Em Cloud Run/App Hosting o módulo persiste enquanto a instância tá quente.
 * Múltiplas instâncias têm caches independentes — aceitável aqui.
 */
const _pagesCache = new Map<string, { pages: PageInfo[]; expires: number }>();
const PAGES_TTL_MS = 10 * 60 * 1000;

function pagesCacheKey(token: string, bmId: string | null | undefined): string {
  // shortcut hash: últimos 12 chars do token (não precisa de crypto pra TTL curto)
  return `${token.slice(-12)}::${bmId ?? '_personal'}`;
}

/**
 * Lista Páginas do FB visíveis ao token. Escopo controlado por `bmId`:
 *  - `bmId === 'Personal'` ou ausente → só `me/accounts` (token pessoal)
 *  - `bmId` real           → `{bm}/owned_pages` + `{bm}/client_pages`
 *
 * Tokens System User (caso normal no REPORT) NÃO retornam nada em `me/accounts`,
 * por isso passamos o bm_id da `meta_ad_accounts` em vez de varrer todos os BMs
 * (varredura ampla dispara rate limit (#4) e (#1) na hora).
 *
 * IG sub-edge é puxado só pelo bm — não no walk pessoal — pra reduzir custo de campo.
 */
export async function listPages(token: string, bmId?: string | null): Promise<PageInfo[]> {
  const key = pagesCacheKey(token, bmId);
  const hit = _pagesCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.pages;

  const FIELDS_WITH_IG = 'id,name,instagram_business_account{id}';
  const FIELDS_LIGHT = 'id,name';

  async function fetchAllPagesUrl(initialUrl: string): Promise<any[]> {
    const out: any[] = [];
    let next: string | null = initialUrl;
    while (next) {
      let res: Response;
      try {
        res = await fetch(next);
      } catch (e) {
        console.warn(`listPages network error: ${e}`);
        break;
      }
      const data: any = await res.json();
      if (data?.error) {
        // (#4) e (#1) caem aqui — interrompe o walk dessa URL, segue o que tiver
        console.warn(`listPages Meta error (${data.error.code}): ${data.error.message}`);
        break;
      }
      if (Array.isArray(data?.data)) out.push(...data.data);
      next = data?.paging?.next ?? null;
    }
    return out;
  }

  const byId = new Map<string, PageInfo>();
  const addAll = (rows: any[]) => {
    for (const r of rows) {
      if (!r?.id) continue;
      if (!byId.has(r.id)) {
        byId.set(r.id, {
          id: r.id,
          name: r.name ?? r.id,
          instagram_business_account: r.instagram_business_account,
        });
      } else if (!byId.get(r.id)!.instagram_business_account && r.instagram_business_account) {
        // mescla IG quando uma fonte trouxer e a anterior não
        byId.get(r.id)!.instagram_business_account = r.instagram_business_account;
      }
    }
  };

  if (!bmId || bmId === 'Personal') {
    // Token pessoal: só me/accounts (System User volta vazio aqui, mas evitamos rate limit)
    addAll(
      await fetchAllPagesUrl(
        `${GRAPH}/me/accounts?fields=${FIELDS_WITH_IG}&limit=50&access_token=${encodeURIComponent(token)}`
      )
    );
  } else {
    // BM específico: owned_pages + client_pages com IG
    const [owned, client] = await Promise.all([
      fetchAllPagesUrl(
        `${GRAPH}/${bmId}/owned_pages?fields=${FIELDS_WITH_IG}&limit=50&access_token=${encodeURIComponent(token)}`
      ),
      fetchAllPagesUrl(
        `${GRAPH}/${bmId}/client_pages?fields=${FIELDS_WITH_IG}&limit=50&access_token=${encodeURIComponent(token)}`
      ),
    ]);
    addAll(owned);
    addAll(client);

    // Se ambas vieram vazias (rate limit ou BM sem páginas), tenta sem IG —
    // o sub-edge é o que mais infla o custo do campo, então com FIELDS_LIGHT a
    // mesma chamada que falhou em (#1) pode passar.
    if (byId.size === 0) {
      const [ownedLite, clientLite] = await Promise.all([
        fetchAllPagesUrl(
          `${GRAPH}/${bmId}/owned_pages?fields=${FIELDS_LIGHT}&limit=50&access_token=${encodeURIComponent(token)}`
        ),
        fetchAllPagesUrl(
          `${GRAPH}/${bmId}/client_pages?fields=${FIELDS_LIGHT}&limit=50&access_token=${encodeURIComponent(token)}`
        ),
      ]);
      addAll(ownedLite);
      addAll(clientLite);
    }
  }

  const pages = Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));

  // Só cacheia se algo veio — resultado vazio (provavelmente rate limit) não vira cache
  // pra usuário poder re-tentar daqui a pouco e popular o dropdown.
  if (pages.length > 0) {
    _pagesCache.set(key, { pages, expires: Date.now() + PAGES_TTL_MS });
  }
  return pages;
}

export interface AudienceInfo {
  id: string;
  name: string;
  subtype: string; // CUSTOM | LOOKALIKE | WEBSITE | ENGAGEMENT | ...
  approximate_count_lower_bound?: number;
  approximate_count_upper_bound?: number;
}

export async function listCustomAudiences(accountId: string, token: string): Promise<AudienceInfo[]> {
  const data = await getGraph<{ data: AudienceInfo[] }>(
    `${accountId}/customaudiences`,
    token,
    { fields: 'id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound', limit: '200' }
  );
  return data.data ?? [];
}

export async function listSavedAudiences(accountId: string, token: string): Promise<AudienceInfo[]> {
  // saved_audiences usa um schema mais enxuto
  const data = await getGraph<{ data: AudienceInfo[] }>(
    `${accountId}/saved_audiences`,
    token,
    { fields: 'id,name,approximate_count_lower_bound,approximate_count_upper_bound', limit: '200' }
  );
  return (data.data ?? []).map((a) => ({ ...a, subtype: 'SAVED' }));
}

// ────────────────────────────────────────────────────────────────────────────
// Catálogos (DPA)
// ────────────────────────────────────────────────────────────────────────────

export interface CatalogInfo {
  id: string;
  name: string;
  product_count?: number;
  vertical?: string;
}

export interface ProductSetInfo {
  id: string;
  name: string;
  product_count?: number;
}

/**
 * Lista catálogos visíveis num BM. Cobre `owned_product_catalogs`
 * (catálogos que o BM possui).
 */
export async function listCatalogs(bmId: string, token: string): Promise<CatalogInfo[]> {
  const data = await getGraph<{ data: CatalogInfo[] }>(
    `${bmId}/owned_product_catalogs`,
    token,
    { fields: 'id,name,product_count,vertical', limit: '100' }
  );
  return data.data ?? [];
}

export async function listProductSets(catalogId: string, token: string): Promise<ProductSetInfo[]> {
  const data = await getGraph<{ data: ProductSetInfo[] }>(
    `${catalogId}/product_sets`,
    token,
    { fields: 'id,name,product_count', limit: '100' }
  );
  return data.data ?? [];
}

// ────────────────────────────────────────────────────────────────────────────
// Lookalike
// ────────────────────────────────────────────────────────────────────────────

export interface CreateLookalikeInput {
  accountId: string;
  token: string;
  name: string;
  origin_audience_id: string;
  /** 0.01 a 0.20 (1% a 20% — top % do país) */
  ratio: number;
  country: string; // ex: 'BR'
  type?: 'similarity' | 'reach';
}

export async function createLookalike(input: CreateLookalikeInput): Promise<{ id: string }> {
  return postGraph<{ id: string }>(
    `${input.accountId}/customaudiences`,
    {
      name: input.name,
      subtype: 'LOOKALIKE',
      origin_audience_id: input.origin_audience_id,
      lookalike_spec: {
        ratio: input.ratio,
        country: input.country,
        type: input.type ?? 'similarity',
      },
    },
    input.token,
    'createLookalike'
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Upload de imagem / vídeo
// ────────────────────────────────────────────────────────────────────────────

/**
 * Faz upload de uma imagem (bytes) para a biblioteca de imagens da conta.
 * Retorna o image_hash que será usado no creative.
 *
 * Doc: POST /act_{id}/adimages
 */
export async function uploadImage(
  accountId: string,
  token: string,
  filename: string,
  bytes: Uint8Array,
  mime: string
): Promise<{ hash: string }> {
  const url = `${GRAPH}/${accountId}/adimages?access_token=${encodeURIComponent(token)}`;
  const form = new FormData();
  form.append(filename, new Blob([new Uint8Array(bytes)], { type: mime }), filename);

  const res = await fetch(url, { method: 'POST', body: form });
  const data: any = await res.json();
  if (data?.error) {
    throw new MetaApiError('uploadImage', data.error.code, buildMetaErrorMessage(data.error), data.error);
  }
  // Resposta no formato: { images: { <filename>: { hash, url } } }
  const entry = data?.images?.[filename];
  if (!entry?.hash) throw new MetaApiError('uploadImage', undefined, 'Resposta sem hash', data);
  return { hash: entry.hash as string };
}

/**
 * Faz upload de um vídeo (bytes) para a biblioteca de vídeos da conta. Tenta
 * buscar a thumbnail auto-gerada (Meta encoda em background ~5-30s) para usar
 * como `image_url` no creative — sem thumbnail o video_data é rejeitado.
 *
 * Doc upload:     POST /act_{id}/advideos          (multipart, campo `source`)
 * Doc thumbs:     GET  /{video_id}/thumbnails      (após encoding)
 *
 * Limite "simples": ~1GB. Para arquivos maiores seria necessário chunked upload
 * (start/transfer/finish) — fora do escopo desta primeira versão.
 */
export async function uploadVideo(
  accountId: string,
  token: string,
  filename: string,
  bytes: Uint8Array,
  mime: string
): Promise<{ video_id: string; thumbnail_url?: string }> {
  const url = `${GRAPH}/${accountId}/advideos?access_token=${encodeURIComponent(token)}`;
  const form = new FormData();
  form.append('source', new Blob([new Uint8Array(bytes)], { type: mime }), filename);
  form.append('name', filename);

  const res = await fetch(url, { method: 'POST', body: form });
  const data: any = await res.json();
  if (data?.error) {
    throw new MetaApiError('uploadVideo', data.error.code, buildMetaErrorMessage(data.error), data.error);
  }
  const video_id = (data?.id ?? data?.video_id) as string | undefined;
  if (!video_id) throw new MetaApiError('uploadVideo', undefined, 'Resposta sem video_id', data);

  // Poll de thumbnails — Meta gera 1 ou mais frames depois do encoding.
  // Tenta ~30s (10 × 3s). Se ainda não tiver, retorna sem thumb e deixa a UI
  // exibir aviso; o creative falhará na criação até a thumb existir.
  const thumbnail_url = await pollVideoThumbnail(video_id, token, 10, 3000);
  return { video_id, thumbnail_url };
}

async function pollVideoThumbnail(
  videoId: string,
  token: string,
  attempts: number,
  intervalMs: number
): Promise<string | undefined> {
  for (let i = 0; i < attempts; i++) {
    try {
      const data = await getGraph<{ data?: { uri: string; is_preferred?: boolean }[] }>(
        `${videoId}/thumbnails`,
        token,
        { fields: 'uri,is_preferred' }
      );
      const thumbs = data?.data ?? [];
      if (thumbs.length > 0) {
        const preferred = thumbs.find((t) => t.is_preferred);
        return (preferred ?? thumbs[0]).uri;
      }
    } catch {
      // ignora e tenta de novo — encoding ainda em curso
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, intervalMs));
  }
  return undefined;
}

// ────────────────────────────────────────────────────────────────────────────
// Criação dos 3 níveis (atômicos)
// ────────────────────────────────────────────────────────────────────────────

export async function createCampaign(
  accountId: string,
  token: string,
  spec: CampaignSpec
): Promise<{ id: string }> {
  const hasCampaignBudget = Boolean(spec.daily_budget_cents || spec.lifetime_budget_cents);
  const params: Record<string, unknown> = {
    name: spec.name,
    objective: spec.objective,
    status: spec.status,
    special_ad_categories: spec.special_ad_categories ?? [],
    buying_type: spec.buying_type ?? 'AUCTION',
    // Sem CBO o Ads Manager envia false — desde 2024 a Meta exige explícito (subcode 4834011).
    is_adset_budget_sharing_enabled: spec.is_adset_budget_sharing_enabled ?? false,
  };
  if (spec.daily_budget_cents) params.daily_budget = spec.daily_budget_cents;
  if (spec.lifetime_budget_cents) params.lifetime_budget = spec.lifetime_budget_cents;
  if (spec.spend_cap_cents) params.spend_cap = spec.spend_cap_cents;
  // bid_strategy só é aceito no nível da campanha quando há orçamento de campanha (CBO).
  if (hasCampaignBudget && spec.bid_strategy) params.bid_strategy = spec.bid_strategy;
  if (spec.promoted_object?.product_catalog_id) {
    params.promoted_object = { product_catalog_id: spec.promoted_object.product_catalog_id };
  }

  return postGraph<{ id: string }>(`${accountId}/campaigns`, params, token, 'createCampaign');
}

export async function createAdSet(
  accountId: string,
  token: string,
  campaign_id: string,
  spec: AdSetSpec
): Promise<{ id: string }> {
  const params: Record<string, unknown> = {
    name: spec.name,
    campaign_id,
    status: spec.status,
    optimization_goal: spec.optimization_goal,
    billing_event: spec.billing_event,
    bid_strategy: spec.bid_strategy ?? 'LOWEST_COST_WITHOUT_CAP',
    promoted_object: spec.promoted_object,
    targeting: spec.targeting,
    destination_type: spec.destination_type ?? 'WEBSITE',
  };
  if (spec.daily_budget_cents) params.daily_budget = spec.daily_budget_cents;
  if (spec.lifetime_budget_cents) params.lifetime_budget = spec.lifetime_budget_cents;
  if (spec.bid_amount_cents) params.bid_amount = spec.bid_amount_cents;
  if (spec.start_time) params.start_time = spec.start_time;
  if (spec.end_time) params.end_time = spec.end_time;
  if (spec.attribution_spec) params.attribution_spec = spec.attribution_spec;

  return postGraph<{ id: string }>(`${accountId}/adsets`, params, token, 'createAdSet');
}

function buildObjectStorySpec(c: CreativeSpec) {
  const base: any = { page_id: c.page_id };
  if (c.instagram_actor_id) base.instagram_actor_id = c.instagram_actor_id;

  if (c.type === 'dpa') {
    // DPA: usa template_data; os campos {{product.*}} viram dinâmicos.
    base.template_data = {
      message: c.message ?? '',
      link: c.template_link ?? '{{product.url}}',
      name: c.headline ?? '{{product.name | titleize}}',
      description: c.description ?? '{{product.description}}',
      call_to_action: c.cta_type
        ? { type: c.cta_type, value: { link: c.cta_link ?? c.template_link ?? '{{product.url}}' } }
        : undefined,
    };
  } else if (c.type === 'carousel') {
    if (!c.child_attachments || c.child_attachments.length < 2) {
      throw new MetaApiError('createAdCreative', undefined, 'Carrossel exige ao menos 2 cards.');
    }
    base.link_data = {
      link: c.child_attachments[0].link, // link "fallback" do carrossel
      message: c.message ?? '',
      child_attachments: c.child_attachments,
      multi_share_optimized: c.multi_share_optimized ?? true,
      multi_share_end_card: true,
    };
  } else if (c.video_id) {
    // Vídeo único: usa video_data. Meta exige uma thumb (image_url ou image_hash).
    if (!c.link) {
      throw new MetaApiError('createAdCreative', undefined, 'Anúncio em vídeo exige link.');
    }
    if (!c.video_thumbnail_url && !c.image_hash) {
      throw new MetaApiError(
        'createAdCreative',
        undefined,
        'Anúncio em vídeo exige miniatura — aguarde o encoding do vídeo terminar e tente de novo.'
      );
    }
    base.video_data = {
      video_id: c.video_id,
      message: c.message ?? '',
      title: c.headline,
      link_description: c.description,
      ...(c.image_hash ? { image_hash: c.image_hash } : { image_url: c.video_thumbnail_url }),
      call_to_action: c.cta_type
        ? { type: c.cta_type, value: { link: c.cta_link ?? c.link, link_format: 'VIDEO_LPP' } }
        : undefined,
    };
  } else {
    if (!c.link || !c.image_hash) {
      throw new MetaApiError('createAdCreative', undefined, 'Anúncio simples exige link e image_hash.');
    }
    base.link_data = {
      link: c.link,
      message: c.message ?? '',
      image_hash: c.image_hash,
      name: c.headline,
      description: c.description,
      call_to_action: c.cta_type
        ? { type: c.cta_type, value: { link: c.cta_link ?? c.link } }
        : undefined,
    };
  }
  return base;
}

export async function createAdCreative(
  accountId: string,
  token: string,
  c: CreativeSpec
): Promise<{ id: string }> {
  // Advantage+ creative optimizations — `standard_enhancements` foi descontinuado
  // em out/2023 (subcode 3858504). Hoje cada recurso é declarado individualmente.
  // Quando o usuário não passa nada, mantemos o default conservador (apenas
  // enhancements visuais leves) que o Ads Manager liga por padrão.
  const defaultFeatures: Record<string, 'OPT_IN' | 'OPT_OUT'> = {
    image_brightness_and_contrast: 'OPT_IN',
    image_enhancement: 'OPT_IN',
    image_touchups: 'OPT_IN',
    image_uncrop: 'OPT_IN',
    text_optimizations: 'OPT_IN',
  };
  const features = { ...defaultFeatures, ...(c.advantage_creative_features ?? {}) };
  const creative_features_spec: Record<string, { enroll_status: 'OPT_IN' | 'OPT_OUT' }> = {};
  for (const [k, v] of Object.entries(features)) creative_features_spec[k] = { enroll_status: v };

  const params: Record<string, unknown> = {
    name: c.name,
    object_story_spec: buildObjectStorySpec(c),
    degrees_of_freedom_spec: { creative_features_spec },
  };
  if (c.url_tags) params.url_tags = c.url_tags;
  // Multi-Advertiser Ads: a Meta defaulta para OPT_IN em OUTCOME_SALES desde 2024.
  // Sem enviar enroll_status explícito ele fica ligado mesmo com o toggle off na UI.
  // Por isso ALWAYS enviamos — OPT_IN se o usuário marcou, OPT_OUT se desmarcou.
  params.contextual_multi_ads = { enroll_status: c.multi_advertiser ? 'OPT_IN' : 'OPT_OUT' };
  if (c.product_set_id && c.type === 'dpa') {
    params.product_set_id = c.product_set_id;
  }

  return postGraph<{ id: string }>(`${accountId}/adcreatives`, params, token, 'createAdCreative');
}

export async function createAd(
  accountId: string,
  token: string,
  adset_id: string,
  name: string,
  creative_id: string,
  status: AdStatus
): Promise<{ id: string }> {
  return postGraph<{ id: string }>(
    `${accountId}/ads`,
    {
      name,
      adset_id,
      creative: { creative_id },
      status,
    },
    token,
    'createAd'
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Orquestrador completo (com callback de progresso para streaming NDJSON)
// ────────────────────────────────────────────────────────────────────────────

export interface OrchestratorEvent {
  type:
    | 'start'
    | 'campaign_created'
    | 'adset_created'
    | 'ad_progress'
    | 'creative_created'
    | 'ad_created'
    | 'done'
    | 'error';
  step?: string;
  id?: string;
  index?: number;
  total?: number;
  campaign_id?: string;
  adset_id?: string;
  ad_ids?: string[];
  error?: string;
  fbCode?: number;
  message?: string;
}

/**
 * Pad determinista pra sufixos de nome: 1 → "01", 9 → "09", 12 → "12".
 */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Substitui variáveis DirectAds em uma string. Variáveis Meta (`{{campaign.id}}`,
 * `{{ad.name}}`, `{{placement}}`, etc.) são preservadas — Meta resolve na entrega.
 *
 * Suporta `{{sequencial:NN}}` (sequencial global do ad). Valores ausentes viram
 * string vazia em vez de erro, pra não quebrar a criação por causa de uma var
 * faltante.
 */
function substituteDirectAdsVars(
  tpl: string,
  vars: {
    conta_nome?: string;
    conta_apelido?: string;
    conta_id?: string;
    pixel?: string;
    objetivo?: string;
    estrutura?: string;
    pagina?: string;
    catalogo_nome?: string;
    conjunto_de_produtos?: string;
    budget?: string;
    criativo?: string;
    criativos?: string;
    fila?: number;
    index?: number;
    conjunto?: number;
    adset?: number;
    ad_sequencial?: number;
    ano?: string;
    mes?: string;
    dia?: string;
    hora?: string;
    minuto?: string;
  }
): string {
  // Variáveis "Facebook" que NÃO devem ser substituídas (a Meta resolve).
  const FB_VARS = new Set([
    'campaign.name', 'campaign.id', 'adset.name', 'adset.id',
    'ad.name', 'ad.id', 'placement', 'site_source_name',
    'product.url', 'product.name', 'product.price', 'product.description',
  ]);
  return tpl.replace(/\{\{([^}]+)\}\}/g, (match, raw) => {
    const key = String(raw).trim();
    if (FB_VARS.has(key)) return match;
    // {{sequencial:XX}} — usa ad_sequencial e padNN
    const seqMatch = key.match(/^sequencial:(\d+)$/i);
    if (seqMatch) {
      const width = Number(seqMatch[1]);
      const v = vars.ad_sequencial ?? 0;
      return String(v).padStart(width, '0');
    }
    const lookup: Record<string, string | number | undefined> = vars as any;
    if (key in lookup && lookup[key] !== undefined) return String(lookup[key]);
    // Não resolvido: deixa intacto (não atrapalha quem usa via Meta)
    return match;
  });
}

/**
 * Orquestrador batch — aplica multiplicadores e round-robin de páginas.
 * Emite os mesmos eventos que createFullCampaign, mas com índices ampliados
 * (campaign_index, adset_index, ad_index) pra UI poder mostrar progresso.
 *
 * Sequencial por ora: APIs Meta marketing limitam ~5 req/s, então paralelismo
 * agressivo dispara (#4) rate limit. Se virar gargalo, dá pra paralelizar
 * por campanha (não por adset, que reusa creative).
 */
export async function createCampaignBatch(
  input: BatchCreateInput,
  onEvent: (e: OrchestratorEvent) => void
): Promise<{ campaign_ids: string[]; adset_ids: string[]; ad_ids: string[] }> {
  const {
    account_id,
    access_token,
    campaigns_per_creative: nCamp,
    adsets_per_campaign: nAdSet,
    ads_per_adset: nAd,
    page_ids,
    page_auto_retry,
    campaign: campaignTpl,
    adset: adsetTpl,
    creatives,
    url_tags_template,
    context,
  } = input;

  const now = new Date();
  const baseCtx = {
    conta_nome:           context?.conta_nome,
    conta_apelido:        context?.conta_apelido,
    conta_id:             context?.conta_id ?? account_id,
    pixel:                context?.pixel,
    objetivo:             context?.objetivo,
    estrutura:            context?.estrutura,
    pagina:               context?.pagina,
    catalogo_nome:        context?.catalogo_nome,
    conjunto_de_produtos: context?.conjunto_de_produtos,
    budget:               context?.budget,
    criativos:            String(creatives.length),
    ano:                  String(now.getFullYear()),
    mes:                  String(now.getMonth() + 1).padStart(2, '0'),
    dia:                  String(now.getDate()).padStart(2, '0'),
    hora:                 String(now.getHours()).padStart(2, '0'),
    minuto:               String(now.getMinutes()).padStart(2, '0'),
  };

  const totalCampaigns = creatives.length * Math.max(1, nCamp);
  const totalAds = totalCampaigns * Math.max(1, nAdSet) * Math.max(1, nAd);
  onEvent({ type: 'start', total: totalAds });

  const campaign_ids: string[] = [];
  const adset_ids: string[] = [];
  const ad_ids: string[] = [];

  let adGlobalIdx = 0;
  let pageRR = 0; // ponteiro round-robin sobre page_ids

  try {
    for (let cIdx = 0; cIdx < creatives.length; cIdx++) {
      const crv = creatives[cIdx];

      for (let ci = 1; ci <= Math.max(1, nCamp); ci++) {
        const campSuffix = nCamp > 1 ? `_C${pad2(ci)}` : '';
        const campSpec: CampaignSpec = {
          ...campaignTpl,
          name: `${campaignTpl.name || crv.name}${creatives.length > 1 ? ` — ${crv.name}` : ''}${campSuffix}`,
        };

        const camp = await createCampaign(account_id, access_token, campSpec);
        campaign_ids.push(camp.id);
        onEvent({ type: 'campaign_created', id: camp.id });

        for (let si = 1; si <= Math.max(1, nAdSet); si++) {
          const setSuffix = nAdSet > 1 ? `_CJ${pad2(si)}` : '';
          const adsetSpec: AdSetSpec = {
            ...adsetTpl,
            name: `${adsetTpl.name || campSpec.name}${setSuffix}`,
          };

          const adset = await createAdSet(account_id, access_token, camp.id, adsetSpec);
          adset_ids.push(adset.id);
          onEvent({ type: 'adset_created', id: adset.id });

          for (let ai = 1; ai <= Math.max(1, nAd); ai++) {
            adGlobalIdx += 1;
            const adSuffix = nAd > 1 ? `_AD${pad2(ai)}` : '';
            const adName = `${crv.name}${adSuffix}`;
            onEvent({ type: 'ad_progress', index: adGlobalIdx, total: totalAds, message: adName });

            // Round-robin de páginas; auto-retry se a primeira página falhar.
            const pagesToTry = page_ids.length > 0
              ? [...page_ids.slice(pageRR % page_ids.length), ...page_ids.slice(0, pageRR % page_ids.length)]
              : [crv.creative.page_id];
            pageRR += 1;

            // URL tags com variáveis DirectAds resolvidas (Meta vars ficam intactas).
            const resolvedUrlTags = url_tags_template
              ? substituteDirectAdsVars(url_tags_template, {
                  ...baseCtx,
                  criativo:       crv.name,
                  fila:           cIdx + 1,
                  index:          cIdx + 1,
                  conjunto:       si,
                  adset:          si,
                  ad_sequencial:  adGlobalIdx,
                })
              : undefined;

            let crCreated: { id: string } | null = null;
            let lastErr: unknown = null;
            for (const pId of pagesToTry) {
              try {
                crCreated = await createAdCreative(account_id, access_token, {
                  ...crv.creative,
                  name: `${adName} — Creative`,
                  page_id: pId,
                  url_tags: resolvedUrlTags ?? crv.creative.url_tags,
                });
                break;
              } catch (e) {
                lastErr = e;
                if (!page_auto_retry) throw e;
              }
            }
            if (!crCreated) throw lastErr ?? new Error('Nenhuma página disponível para o creative.');

            onEvent({ type: 'creative_created', index: adGlobalIdx, id: crCreated.id });

            const ad = await createAd(account_id, access_token, adset.id, adName, crCreated.id, campSpec.status);
            ad_ids.push(ad.id);
            onEvent({ type: 'ad_created', index: adGlobalIdx, id: ad.id });
          }
        }
      }
    }

    onEvent({
      type: 'done',
      campaign_id: campaign_ids[campaign_ids.length - 1],
      adset_id: adset_ids[adset_ids.length - 1],
      ad_ids,
    });
    return { campaign_ids, adset_ids, ad_ids };
  } catch (err: any) {
    const step = err instanceof MetaApiError ? err.step : 'unknown';
    const fbCode = err instanceof MetaApiError ? err.fbCode : undefined;
    onEvent({
      type: 'error',
      step,
      fbCode,
      error: err?.message ?? String(err),
      campaign_id: campaign_ids[campaign_ids.length - 1],
      adset_id: adset_ids[adset_ids.length - 1],
      ad_ids,
    });
    throw err;
  }
}

export async function createFullCampaign(
  input: CreateFullCampaignInput,
  onEvent: (e: OrchestratorEvent) => void
): Promise<{ campaign_id: string; adset_id: string; ad_ids: string[] }> {
  const { account_id, access_token, campaign, adset, ads } = input;

  onEvent({ type: 'start', total: ads.length });

  let campaignId = '';
  let adsetId = '';
  const adIds: string[] = [];

  try {
    const camp = await createCampaign(account_id, access_token, campaign);
    campaignId = camp.id;
    onEvent({ type: 'campaign_created', id: campaignId });

    const adset_res = await createAdSet(account_id, access_token, campaignId, adset);
    adsetId = adset_res.id;
    onEvent({ type: 'adset_created', id: adsetId });

    for (let i = 0; i < ads.length; i++) {
      const a = ads[i];
      onEvent({ type: 'ad_progress', index: i + 1, total: ads.length, message: a.name });

      const cr = await createAdCreative(account_id, access_token, a.creative);
      onEvent({ type: 'creative_created', index: i + 1, id: cr.id });

      const ad = await createAd(account_id, access_token, adsetId, a.name, cr.id, campaign.status);
      adIds.push(ad.id);
      onEvent({ type: 'ad_created', index: i + 1, id: ad.id });
    }

    onEvent({ type: 'done', campaign_id: campaignId, adset_id: adsetId, ad_ids: adIds });
    return { campaign_id: campaignId, adset_id: adsetId, ad_ids: adIds };
  } catch (err: any) {
    const step = err instanceof MetaApiError ? err.step : 'unknown';
    const fbCode = err instanceof MetaApiError ? err.fbCode : undefined;
    onEvent({
      type: 'error',
      step,
      fbCode,
      error: err?.message ?? String(err),
      campaign_id: campaignId || undefined,
      adset_id: adsetId || undefined,
      ad_ids: adIds,
    });
    throw err;
  }
}
