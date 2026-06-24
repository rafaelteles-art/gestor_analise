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

// Relative imports (nao `@/lib/...`) de proposito: o vitest deste repo NAO
// resolve o alias `@/` (sem vite-tsconfig-paths), entao importar este modulo num
// teste quebrava em "Cannot find package '@/lib/timezone'". Caminhos relativos
// resolvem igual no tsc/Next e tornam expandBatch/dropCriativoToken (e o resto do
// modulo) importaveis pelos testes.
import { toDatetimeLocal } from './timezone';
import type {
  SeparationLevel,
  BatchRunState,
  BatchEvent,
  BatchRunOpts,
  BatchRunResult,
  CreativeMedia,
} from './batch-contract';

// Re-export do contrato compartilhado entre agentes (lib/batch-contract.ts).
export type {
  SeparationLevel,
  BatchRunState,
  BatchEvent,
  BatchRunOpts,
  BatchRunResult,
  CreateCampaignBatchFn,
  CreativeMedia,
} from './batch-contract';

export const META_API_VERSION = 'v22.0';
const GRAPH = `https://graph.facebook.com/${META_API_VERSION}`;

/**
 * Gate p/ logs de diagnóstico (targeting/promoted_object/object_story_spec/PBIA).
 * No batch (N*C*S*A) esses logs disparam por-entidade e despejam IDs de audiência,
 * pixel e spec de catálogo centenas de vezes. Ficam OFF por padrão; ligue com
 * META_DEBUG=1 (ou =true) só para diagnosticar. Não é flag de UI.
 */
const META_DEBUG = process.env.META_DEBUG === '1' || process.env.META_DEBUG === 'true';
function metaDebugLog(...args: unknown[]): void {
  if (META_DEBUG) console.log(...args);
}

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
  | 'THRUPLAY'
  /** Engagement (curtidas/seguidores da Página). Exige promoted_object.page_id. */
  | 'PAGE_LIKES';

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
  | 'ORDER_NOW'
  /** Engagement: botão "Curtir Página". value = { page: <page_id> }, não { link }. */
  | 'LIKE_PAGE';

export interface PromotedObject {
  pixel_id?: string;
  custom_event_type?: CustomEventType;
  /** Catálogo (DPA). Obrigatório quando a campanha é PRODUCT_CATALOG_SALES. */
  product_catalog_id?: string;
  /** Conjunto de produtos dentro do catálogo. Opcional — sem isso usa o catálogo inteiro. */
  product_set_id?: string;
  /** Página promovida. Obrigatório quando optimization_goal = PAGE_LIKES (engagement). */
  page_id?: string;
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
  /**
   * IG identity. Em v22.0 (set/2025) a Meta deprecou `instagram_actor_id` e
   * renomeou para `instagram_user_id` — aceita IG Business conectado *ou* PBIA
   * (Page-Backed Instagram Account). Mantemos o nome antigo como alias só
   * pra não quebrar callers existentes.
   */
  instagram_user_id?: string;
  /** @deprecated use `instagram_user_id` — kept as alias para compatibilidade */
  instagram_actor_id?: string;
  /** "single" → uma imagem ou vídeo; "carousel" → 2-10 child_attachments; "dpa" → template DPA */
  type: 'single' | 'carousel' | 'dpa';
  /**
   * Engagement (curtidas de Página). Quando true, o creative é um anúncio de
   * "Curtir Página": sem destino externo, `link` é a URL da própria Página e o
   * CTA é LIKE_PAGE apontando para `page_id`. Ignora headline/description/url_tags
   * e NÃO resolve identidade IG/PBIA (entrega é Facebook-only). Vale para imagem
   * (link_data) e vídeo (video_data).
   */
  page_like?: boolean;
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
  // ON_PAGE: exigido por campanhas de engajamento PAGE_LIKES (OUTCOME_ENGAGEMENT).
  destination_type?: 'WEBSITE' | 'APP' | 'MESSENGER' | 'WHATSAPP' | 'ON_PAGE';
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
  /**
   * Alocação manual de criativos por página (chave = page_id).
   * Páginas com valor aqui recebem exatamente esse número de ads; o restante
   * é distribuído em round-robin entre as páginas que NÃO aparecem neste mapa.
   * Quando nenhuma página tem alocação manual, o comportamento é o round-robin
   * clássico sobre todas as páginas em `page_ids`.
   */
  page_allocations?: Record<string, number>;
  /** Se ligado, tenta a próxima página em caso de erro no creative. */
  page_auto_retry: boolean;
  /** Template da campanha (name vira prefixo: name_C01, name_C02…). */
  campaign: CampaignSpec;
  /** Template do conjunto (idem prefixo). */
  adset: AdSetSpec;
  /**
   * Um "criativo" por linha — o orquestrador aplica multiplicadores.
   * `media` é o envelope opcional do contrato compartilhado (batch-contract.ts):
   * quando `source:'meta'`, mergeMedia() aplica image_hash/video_id resolvidos no
   * CreativeSpec antes do createAdCreative. Sem este campo tipado, o merge era um
   * cast `as any` que silenciava o erro de tipo e DESCARTAVA a mídia em callers
   * que a fornecem via o envelope (ad sem creative media). Agora é tipado e real.
   */
  creatives: { name: string; creative: CreativeSpec; media?: CreativeMedia }[];
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
  /**
   * Nivel de separacao de criativos (F7). Total SEMPRE N*C*S*A — muda so o
   * AGRUPAMENTO. Default 'campaign' = comportamento historico (cada criativo
   * isolado em suas proprias campanhas). Veja `expandBatch`.
   */
  separation_level?: SeparationLevel;
  /**
   * Contexto de data/hora CONGELADO no momento do enfileiramento (A1).
   * Quando presente, {{data}}/{{hora}}/{{ano}}/... usam estes valores em vez de
   * now() — garante que um job que so roda 2 min depois (ou retoma horas apos um
   * budget abort) mantenha o carimbo de quando o usuario clicou em criar.
   * Ausente -> fallback para o relogio de parede atual (back-compat).
   */
  frozen_context?: {
    ano?: string;
    mes?: string;
    dia?: string;
    hora?: string;
    minuto?: string;
    /** 'YYYY-MM-DD' opcional — alguns templates usam {{data}} direto. */
    data?: string;
    /** 'HH:mm' opcional — alguns templates usam {{hora}} a partir daqui. */
    hora_completa?: string;
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers internos
// ────────────────────────────────────────────────────────────────────────────

class MetaApiError extends Error {
  /** HTTP status da resposta Graph (quando conhecido) — classifica 429/5xx como transitorio. */
  public httpStatus?: number;
  /** `Retry-After` em segundos (quando a Meta o envia) — honrado pelo backoff. */
  public retryAfterSec?: number;
  constructor(public step: string, public fbCode: number | undefined, message: string, public raw?: unknown) {
    super(message);
    this.name = 'MetaApiError';
  }
}

/** Le e parseia o header `Retry-After` (segundos) de uma Response. */
function parseRetryAfter(res: Response): number | undefined {
  const h = res.headers.get('retry-after');
  if (!h) return undefined;
  const n = Number(h);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
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
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // 5xx/gateway pode devolver HTML/texto sem JSON — segue p/ classificar via status.
  }
  if (data?.error) {
    const e = new MetaApiError(step, data.error.code, buildMetaErrorMessage(data.error), data.error);
    e.httpStatus = res.status;
    e.retryAfterSec = parseRetryAfter(res);
    throw e;
  }
  if (!res.ok) {
    // Sem objeto `error` no corpo mas status HTTP de falha (ex.: 429/500/502/503).
    const e = new MetaApiError(step, undefined, `HTTP ${res.status} ${res.statusText || ''}`.trim(), data);
    e.httpStatus = res.status;
    e.retryAfterSec = parseRetryAfter(res);
    throw e;
  }
  return data as T;
}

async function getGraph<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const u = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set('access_token', token);
  const res = await fetch(u.toString());
  // Espelha postGraph: 5xx/gateway pode devolver HTML/texto sem JSON. Sem este
  // guard, res.json() lançaria um SyntaxError cru (não-MetaApiError), que
  // isTransientError() NÃO classifica como transiente — logo o retry/backoff não
  // absorveria o 5xx que ele justamente existe pra cobrir (ex.: PBIA dentro de
  // createAdCreative virando falha permanente). Classificamos via res.status.
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // corpo não-JSON — segue p/ classificar via status HTTP abaixo.
  }
  if (data?.error) {
    const e = new MetaApiError('GET ' + path, data.error.code, buildMetaErrorMessage(data.error), data.error);
    e.httpStatus = res.status;
    e.retryAfterSec = parseRetryAfter(res);
    throw e;
  }
  if (!res.ok) {
    const e = new MetaApiError('GET ' + path, undefined, `HTTP ${res.status} ${res.statusText || ''}`.trim(), data);
    e.httpStatus = res.status;
    e.retryAfterSec = parseRetryAfter(res);
    throw e;
  }
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
      // Espelha postGraph/getGraph: um 5xx/gateway da Meta pode devolver HTML/
      // texto sem JSON. Sem este guard, res.json() lançaria um SyntaxError cru
      // que ESCAPA do listPages (a branch `if (data?.error)` nunca é alcançada),
      // quebrando o dropdown de Páginas em vez de degradar como o resto da fn já
      // faz (erro de rede no try acima, erro Meta logo abaixo). Corpo não-JSON =
      // trata como break — interrompe o walk e segue com o que já coletou.
      let data: any = null;
      try {
        data = await res.json();
      } catch {
        console.warn('listPages: resposta nao-JSON (5xx/gateway?) — interrompendo walk');
        break;
      }
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

export interface BusinessManagerInfo {
  id: string;
  name: string;
}

/**
 * Lista BMs visíveis ao token. Combina três fontes:
 *
 *  1. `/me?fields=business`   — para System User tokens, esse é o BM-mãe
 *     (que criou o System User). NÃO aparece em `/me/businesses` em muitos
 *     casos. É o único jeito de descobrir o BM-pai de um SU.
 *  2. `/me/businesses`        — BMs onde o usuário é membro/admin (geralmente
 *     funciona para User Tokens; SU pode retornar vazio).
 *  3. `/{bm_id}/owned_businesses` por BM — sub-BMs (BMs filhas) de cada um
 *     dos BMs descobertos acima.
 *
 * Deduplica por id e ordena por nome.
 */
export async function listBusinessManagers(token: string): Promise<BusinessManagerInfo[]> {
  const map = new Map<string, BusinessManagerInfo>();

  // 1) BM-mãe via /me?fields=business (essencial para System User tokens)
  try {
    const me = await getGraph<{ id: string; business?: BusinessManagerInfo }>(
      `me`,
      token,
      { fields: 'id,business' }
    );
    if (me.business?.id) map.set(me.business.id, { id: me.business.id, name: me.business.name ?? me.business.id });
  } catch {
    // /me sem permissão — segue
  }

  // 2) BMs em /me/businesses (User tokens; SU pode vir vazio)
  let directList: BusinessManagerInfo[] = [];
  try {
    const direct = await getGraph<{ data: BusinessManagerInfo[] }>(
      `me/businesses`,
      token,
      { fields: 'id,name', limit: '200' }
    );
    directList = direct.data ?? [];
    for (const bm of directList) if (!map.has(bm.id)) map.set(bm.id, bm);
  } catch {
    // SU costuma não responder isso — segue
  }

  // 3) Para cada BM descoberto, busca sub-BMs (owned_businesses)
  const allKnown = Array.from(map.values());
  for (const bm of allKnown) {
    try {
      const owned = await getGraph<{ data: BusinessManagerInfo[] }>(
        `${bm.id}/owned_businesses`,
        token,
        { fields: 'id,name', limit: '200' }
      );
      for (const ob of owned.data ?? []) {
        if (!map.has(ob.id)) map.set(ob.id, ob);
      }
    } catch {
      // BM problemático não derruba o restante
    }
  }

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Cria um Product Catalog novo dentro do BM.
 * Endpoint: POST /{business_id}/owned_product_catalogs
 * Campos: name (obrigatório), vertical (opcional — default 'commerce').
 */
export async function createCatalog(
  bmId: string,
  name: string,
  token: string,
  vertical: string = 'commerce'
): Promise<CatalogInfo> {
  const created = await postGraph<{ id: string }>(
    `${bmId}/owned_product_catalogs`,
    { name, vertical },
    token,
    'createCatalog'
  );
  return { id: created.id, name, vertical, product_count: 0 };
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
  // Espelha postGraph/getGraph: um 5xx/gateway da Meta pode devolver HTML/texto
  // sem JSON. Sem este guard, res.json() lançaria um SyntaxError cru (não-
  // MetaApiError) que isTransientError() NÃO classifica como transiente — logo o
  // retry/backoff não absorveria o 5xx. Corpo não-JSON: classificamos via status.
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // corpo não-JSON — segue p/ classificar via status HTTP abaixo.
  }
  if (data?.error) {
    const e = new MetaApiError('uploadImage', data.error.code, buildMetaErrorMessage(data.error), data.error);
    e.httpStatus = res.status;
    e.retryAfterSec = parseRetryAfter(res);
    throw e;
  }
  if (!res.ok) {
    // Sem objeto `error` no corpo mas status HTTP de falha (ex.: 429/5xx).
    const e = new MetaApiError('uploadImage', undefined, `HTTP ${res.status} ${res.statusText || ''}`.trim(), data);
    e.httpStatus = res.status;
    e.retryAfterSec = parseRetryAfter(res);
    throw e;
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
  // Espelha postGraph/getGraph: um 5xx/gateway da Meta pode devolver HTML/texto
  // sem JSON. Sem este guard, res.json() lançaria um SyntaxError cru (não-
  // MetaApiError) que isTransientError() NÃO classifica como transiente — logo o
  // retry/backoff não absorveria o 5xx. Corpo não-JSON: classificamos via status.
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // corpo não-JSON — segue p/ classificar via status HTTP abaixo.
  }
  if (data?.error) {
    const e = new MetaApiError('uploadVideo', data.error.code, buildMetaErrorMessage(data.error), data.error);
    e.httpStatus = res.status;
    e.retryAfterSec = parseRetryAfter(res);
    throw e;
  }
  if (!res.ok) {
    // Sem objeto `error` no corpo mas status HTTP de falha (ex.: 429/5xx).
    const e = new MetaApiError('uploadVideo', undefined, `HTTP ${res.status} ${res.statusText || ''}`.trim(), data);
    e.httpStatus = res.status;
    e.retryAfterSec = parseRetryAfter(res);
    throw e;
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
    // Conjuntos sempre nascem ACTIVE — a pausa fica só na campanha (controle do usuário).
    status: 'ACTIVE',
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

  // DEBUG (gated por META_DEBUG): params exatos enviados — usado p/ diagnosticar
  // erro de promoted_object. OFF no batch hot path por padrão.
  metaDebugLog('[createAdSet] params →', JSON.stringify({
    optimization_goal: params.optimization_goal,
    promoted_object: params.promoted_object,
    destination_type: params.destination_type,
    campaign_id: params.campaign_id,
    targeting: params.targeting,
    billing_event: params.billing_event,
    bid_strategy: params.bid_strategy,
  }, null, 2));

  return postGraph<{ id: string }>(`${accountId}/adsets`, params, token, 'createAdSet');
}

/**
 * Resolve um `instagram_actor_id` para uma Página que NÃO tem IG Business Account
 * conectado. Faz isso via Page-Backed Instagram Account (PBIA) — a "conta sombra"
 * que a Meta cria atrás dos panos quando o anunciante escolhe "Usar Página do
 * Facebook" no Ads Manager.
 *
 * Sem isso, o ad creative quebra com (#100/1772103) "conta do Instagram ausente"
 * em ad sets com placements de IG. Mandar `page_id` direto também não rola
 * — a Meta valida e rejeita ((#100) "must be a valid Instagram account id").
 *
 * Fluxo:
 *   1. Pega o page access token via `GET /{page}?fields=access_token` com o token do user/SU.
 *      ⚠ Requer SU token com role de admin na Página (não User token genérico — Page Admin direto).
 *   2. Tenta `GET /{page}/page_backed_instagram_accounts` (edge plural) com o page token — retorna lista
 *      com a PBIA existente se já tiver sido criada. ATENÇÃO: NÃO é `?fields=page_backed_instagram_account`
 *      (singular) — esse é tratado como campo e a Meta retorna (#100) "nonexisting field".
 *   3. Se a lista veio vazia, `POST /{page}/page_backed_instagram_accounts` cria uma nova
 *      (idempotente: se já existir, retorna a mesma).
 *
 * IMPORTANTE (v22.0+): O ID retornado é passado em `instagram_user_id` (campo novo, substituto
 * de `instagram_actor_id` que foi deprecado em set/2025). Na v21 a PBIA era rejeitada quando
 * setada em `instagram_actor_id` com (#100) "must be a valid Instagram account id" — pelo
 * nome novo a Meta aceita.
 *
 * Para DPA é OBRIGATÓRIO setar — omitir dispara (#100/1772103) "IG account missing" no createAd.
 * Para anúncios simples a Meta resolve via PBIA mesmo sem o campo, mas setamos sempre por consistência.
 *
 * Cacheado em memória pra não repetir em batches de múltiplos creatives na mesma Página.
 */
const _pbiaCache = new Map<string, { igId: string; expires: number }>();
const PBIA_TTL_MS = 30 * 60 * 1000;

async function resolvePageBackedInstagram(pageId: string, token: string): Promise<string> {
  const key = `${token.slice(-12)}::${pageId}`;
  const hit = _pbiaCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.igId;

  // 1) page access token via user/SU token
  let pageToken: string | undefined;
  try {
    const r = await getGraph<{ access_token?: string }>(pageId, token, { fields: 'access_token' });
    pageToken = r.access_token;
  } catch (err) {
    const msg = (err as Error).message;
    const isPermErr = /pages_read_engagement|permission|\(#10\)|\(#200\)/i.test(msg);
    throw new MetaApiError(
      'resolvePageBackedInstagram',
      undefined,
      isPermErr
        ? `Página ${pageId} sem Instagram conectado. Para anunciar, escolha UMA das opções: ` +
          `(A) Conecte uma conta IG Business à Página em Configurações da Página → Contas vinculadas; ` +
          `(B) Crie uma campanha qualquer no Ads Manager com "Usar Página do Facebook" como identidade IG — ` +
          `isso cria a Page-Backed Instagram Account na Meta e a API passa a usá-la automaticamente; ou ` +
          `(C) Adicione o scope 'pages_read_engagement' ao token. Detalhe Meta: ${msg}`
        : `Não consegui pegar o page access token de ${pageId}. Detalhe: ${msg}`
    );
  }
  if (!pageToken) {
    throw new MetaApiError(
      'resolvePageBackedInstagram',
      undefined,
      `Página ${pageId} sem IG conectado. Conecte um IG Business à Página, ou bootstrap a PBIA criando uma campanha via Ads Manager uma vez (com "Usar Página do Facebook").`
    );
  }

  // 2) PBIA existente? (é EDGE plural, NÃO campo — Meta retorna lista)
  let igId: string | undefined;
  try {
    const existing = await getGraph<{ data?: { id: string }[] }>(
      `${pageId}/page_backed_instagram_accounts`,
      pageToken
    );
    igId = existing.data?.[0]?.id;
  } catch (err) {
    console.warn('[resolvePageBackedInstagram] GET /page_backed_instagram_accounts falhou:', (err as Error).message);
  }

  // 3) Cria se não existir
  if (!igId) {
    try {
      const created = await postGraph<{ id: string }>(
        `${pageId}/page_backed_instagram_accounts`,
        {},
        pageToken,
        'createPageBackedInstagram'
      );
      igId = created.id;
    } catch (err) {
      throw new MetaApiError(
        'resolvePageBackedInstagram',
        undefined,
        `Página ${pageId} não tem IG conectado e a criação da Page-Backed Instagram Account falhou. Detalhe: ${(err as Error).message}`
      );
    }
  }

  if (!igId) {
    throw new MetaApiError(
      'resolvePageBackedInstagram',
      undefined,
      `Página ${pageId} sem IG conectado e PBIA retornou vazio.`
    );
  }

  _pbiaCache.set(key, { igId, expires: Date.now() + PBIA_TTL_MS });
  return igId;
}

function buildObjectStorySpec(c: CreativeSpec) {
  const base: any = { page_id: c.page_id };
  // v22.0+: `instagram_user_id` substitui `instagram_actor_id`. Aceitamos os dois
  // nomes em CreativeSpec mas SEMPRE enviamos o nome novo para a Meta.
  const igUserId = c.instagram_user_id ?? c.instagram_actor_id;
  if (igUserId) base.instagram_user_id = igUserId;

  if (c.page_like) {
    // Engagement (curtidas da Página): sem destino externo. A Meta exige um
    // `link` no link_data/video_data — usamos a URL da própria Página — e o CTA
    // é LIKE_PAGE com value.page = page_id (NÃO value.link). headline/description/
    // url_tags não se aplicam a um anúncio de curtida.
    const cta = { type: 'LIKE_PAGE', value: { page: c.page_id } };
    const pageUrl = `https://facebook.com/${c.page_id}`;
    if (c.video_id) {
      if (!c.video_thumbnail_url && !c.image_hash) {
        throw new MetaApiError(
          'createAdCreative',
          undefined,
          'Anúncio de engajamento em vídeo exige miniatura — aguarde o encoding terminar e tente de novo.'
        );
      }
      base.video_data = {
        video_id: c.video_id,
        message: c.message ?? '',
        ...(c.image_hash ? { image_hash: c.image_hash } : { image_url: c.video_thumbnail_url }),
        call_to_action: cta,
      };
    } else {
      if (!c.image_hash) {
        throw new MetaApiError('createAdCreative', undefined, 'Anúncio de engajamento exige uma imagem.');
      }
      base.link_data = {
        link: pageUrl,
        message: c.message ?? '',
        image_hash: c.image_hash,
        call_to_action: cta,
      };
    }
  } else if (c.type === 'dpa') {
    // DPA: usa template_data. Tokens {{product.*}} são dinâmicos em
    // message/name/description, MAS o `link` precisa ser uma URL REAL: a Meta
    // valida esse campo como URL literal no createAdCreative e rejeita
    // `{{product.url}}` com BM86/subcode 2061006 ("a URL não direciona para um
    // site"). O destino por produto vem automaticamente do feed do catálogo —
    // este `link` é só a URL base/fallback exigida pela Meta.
    if (!c.template_link || c.template_link.includes('{{')) {
      throw new MetaApiError(
        'createAdCreative',
        undefined,
        'DPA exige uma URL de destino real (ex.: https://seusite.com). A Meta rejeita {{product.url}} no campo link (BM86/2061006) — o destino por produto vem do catálogo automaticamente.'
      );
    }
    base.template_data = {
      message: c.message || '{{product.name}}',
      link: c.template_link,
      name: c.headline || '{{product.name | titleize}}',
      description: c.description || '{{product.description}}',
      call_to_action: c.cta_type
        ? { type: c.cta_type, value: { link: c.cta_link || c.template_link } }
        : undefined,
      // Formato "Imagem única/Vídeo" com vídeo priorizado ("Priorizar vídeo" no Ads
      // Manager). Sem isto a Meta defaulta para carrossel/coleção (e injeta
      // asset_feed_spec ad_formats=[CAROUSEL,COLLECTION] + multi_share_end_card:true).
      // Espelha o anúncio de referência BM118 (lido via API): format_option=single_video
      // + multi_share_end_card=false, sem asset_feed_spec.
      format_option: 'single_video',
      multi_share_end_card: false,
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
  // Se a Página não veio com IG Business Account, GARANTE que existe uma
  // Page-Backed Instagram Account (PBIA) — mas NÃO seta `instagram_actor_id`
  // com o ID dela. Esse campo só aceita IG Business *conectado*; passar PBIA ID
  // direto dá (#100) "must be a valid Instagram account id". A Meta resolve
  // a PBIA automaticamente quando o campo é omitido E ela existe na Página.
  const incomingIg = c.instagram_user_id ?? c.instagram_actor_id;
  metaDebugLog('[createAdCreative] page_id=', c.page_id, 'instagram_user_id IN=', incomingIg);
  // Engagement (page_like) entrega só no Facebook — não precisa (nem queremos)
  // resolver identidade IG/PBIA. Pular a resolução evita uma chamada extra e o
  // erro em Páginas sem PBIA elegível.
  if (!incomingIg && c.page_id && !c.page_like) {
    const pbia = await resolvePageBackedInstagram(c.page_id, token);
    // v22.0: PBIA agora é aceita como `instagram_user_id` (era rejeitada como
    // `instagram_actor_id` na v21). Setar explicitamente — DPA exige identidade
    // declarada no creative, não resolve por omissão.
    c = { ...c, instagram_user_id: pbia };
    metaDebugLog('[createAdCreative] PBIA resolved=', pbia, '— setado em instagram_user_id (v22 API).');
  } else {
    metaDebugLog('[createAdCreative] IG identity já veio na spec. Skip resolver.');
  }

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
  };
  if (c.page_like) {
    // Engagement (curtidas): sem identidade IG, então NÃO enviamos o bundle
    // visual (image_*). Esses recursos disparam #100/1772103 ("IG account
    // missing") quando não há IG conectado — mesmo padrão de cautela do DPA.
    // Nenhum degrees_of_freedom_spec.
  } else if (c.type !== 'dpa') {
    // Non-DPA (single/carousel/video): bundle Advantage+ Creative completo.
    params.degrees_of_freedom_spec = { creative_features_spec };
  } else {
    // DPA Single Video: o vídeo é priorizado pelo FORMATO (template_data.format_option
    // = 'single_video'), não por features de mídia dinâmica. O anúncio de referência
    // BM118 (com "Priorizar vídeo" ON, lido via API) tem SÓ hide_price OPT_IN —
    // media_type_automation e video_highlights ficam OPT_OUT (não fazem sentido quando
    // o formato já força o vídeo). Espelhamos isso à risca.
    //
    // HISTÓRICO: já mandamos video_highlights + media_type_automation aqui ("Mostrar
    // vídeo", 2026-06-23) no formato carrossel. Ao trocar para single_video, removidos
    // por divergirem da referência. Sem o bundle visual (image_*), que disparava
    // #100/1772103 "IG account missing". Se o #100 voltar, suspeitar deste bloco.
    params.degrees_of_freedom_spec = {
      creative_features_spec: {
        hide_price: { enroll_status: 'OPT_IN' },
      },
    };
  }
  if (c.url_tags) params.url_tags = c.url_tags;
  // Multi-Advertiser Ads: a Meta defaulta para OPT_IN em OUTCOME_SALES desde 2024.
  // Sem enviar enroll_status explícito ele fica ligado mesmo com o toggle off na UI.
  // Por isso ALWAYS enviamos — OPT_IN se o usuário marcou, OPT_OUT se desmarcou.
  // Exceção: engagement (page_like) não suporta multi-advertiser — não enviar.
  if (!c.page_like) {
    params.contextual_multi_ads = { enroll_status: c.multi_advertiser ? 'OPT_IN' : 'OPT_OUT' };
  }
  if (c.product_set_id && c.type === 'dpa') {
    params.product_set_id = c.product_set_id;
  }

  if (c.type === 'dpa') {
    metaDebugLog('[createAdCreative DPA] →', JSON.stringify({
      account_id: accountId,
      product_set_id: params.product_set_id,
      object_story_spec: params.object_story_spec,
    }, null, 2));
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
    | 'error'
    // Broadcast (multi-conta) — só usados pela route, createCampaignBatch
    // continua single-account e não emite estes.
    | 'account_start'
    | 'account_done'
    | 'account_error'
    | 'broadcast_summary';
  step?: string;
  id?: string;
  index?: number;
  total?: number;
  campaign_id?: string;
  adset_id?: string;
  ad_ids?: string[];
  /** Página efetivamente usada no creative deste ad (após eventual auto-retry). */
  page_id?: string;
  error?: string;
  fbCode?: number;
  message?: string;
  /** Conta-alvo em modo broadcast — preenchido pela route quando há mais de uma conta. */
  account_id?: string;
  /** Resumo final do broadcast — preenchido apenas em `broadcast_summary`. */
  success?: Array<{ account_id: string; campaign_ids: string[]; adset_ids: string[]; ad_ids: string[] }>;
  failed?: Array<{ account_id: string; error: string }>;
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
 *
 * Exportada para teste de regressão da resolução own-property-only (templates são
 * user-authored; ver meta-campaigns-naming.test.ts).
 */
export function substituteDirectAdsVars(
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
    // hasOwnProperty (não `key in lookup`): o operador `in` anda na prototype chain,
    // então tokens user-authored como {{toString}}/{{constructor}}/{{valueOf}}
    // casariam com herdados de Object.prototype e injetariam o source da função
    // (String(fn)) na string resolvida. Object.hasOwn limita às chaves próprias.
    if (Object.prototype.hasOwnProperty.call(lookup, key) && lookup[key] !== undefined) {
      return String(lookup[key]);
    }
    // Não resolvido: deixa intacto (não atrapalha quem usa via Meta)
    return match;
  });
}

/**
 * Remove o token {{criativo}} (e os separadores adjacentes) de um template de
 * nome, para uso quando a ENTIDADE nomeada contem mais de um criativo — caso em
 * que {{criativo}} nao tem valor unico. F7.
 * Separadores reconhecidos: - (hifen) U+2014 U+2013 _ |.
 */
export function dropCriativoToken(tpl: string): string {
  return tpl
    .replace(/\s*[-\u2014\u2013_|]\s*\{\{criativo\}\}\s*[-\u2014\u2013_|]\s*/g, ' - ')
    .replace(/\s*[-\u2014\u2013_|]?\s*\{\{criativo\}\}\s*[-\u2014\u2013_|]?\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Valor do token {{conta}} em nomes de entidade: o apelido (nickname) tem
 * precedencia sobre o nome da conta (F3). Vazio se nenhum existir.
 */
export function contaTokenValue(ctx: { conta_apelido?: string; conta_nome?: string }): string {
  return ctx.conta_apelido || ctx.conta_nome || '';
}

/**
 * Resolve o nome de uma campanha/conjunto a partir do template, POR JOB:
 *  - {{conta}} -> apelido||nome da conta deste job. Resolvido no servidor (nao no
 *    builder) para que um broadcast multi-conta nomeie cada conta com a SUA
 *    identidade, em vez de clonar a da primeira conta selecionada.
 *  - {{criativo}} -> nome do criativo; OU removido (entidade multi-criativo) via
 *    dropCriativoToken. Quando ha varios criativos e o template nao traz o token,
 *    anexa " \u2014 <criativo>" para manter os nomes unicos.
 * `creativeName === null` sinaliza entidade compartilhada por varios criativos.
 */
export function resolveEntityName(
  tplName: string,
  creativeName: string | null,
  suffix: string,
  opts: { conta: string; multiCreative: boolean }
): string {
  const withConta = tplName.replace(/\{\{\s*conta\s*\}\}/gi, opts.conta);
  if (creativeName === null) {
    return `${dropCriativoToken(withConta)}${suffix}`;
  }
  const replaced = withConta.replace(/\{\{\s*criativo\s*\}\}/gi, creativeName);
  const needsSuffix = opts.multiCreative && replaced === withConta;
  return `${replaced}${needsSuffix ? ` \u2014 ${creativeName}` : ''}${suffix}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Separacao de criativos (F7) — expansao pura, testavel sem a Meta
// ────────────────────────────────────────────────────────────────────────────

/** Uma campanha planejada da expansao batch, com sua chave determinista. */
export interface PlannedCampaign {
  key: string;                 // c:<cr|->:<ci>
  creativeIdx: number | null;  // null = compartilhada (varios criativos)
  campIdx: number;             // 0-based
  campSuffixNum: number;       // numeracao continua do sufixo _C (1-based)
}
export interface PlannedAdSet {
  key: string;                 // s:<cr|->:<ci>:<si>
  campKey: string;             // chave da campanha-pai
  creativeIdx: number | null;
  campIdx: number;
  adsetIdx: number;            // 0-based dentro da campanha
  setSuffixNum: number;        // numeracao continua do sufixo _CJ dentro da campanha
}
export interface PlannedAd {
  key: string;                 // a:<cr>:<ci>:<si>:<ai>
  adsetKey: string;            // chave do adset-pai
  creativeIdx: number;         // o ad SEMPRE pertence a um criativo concreto
  campIdx: number;
  adsetIdx: number;
  adIdx: number;               // 0-based dentro do adset
  adSuffixNum: number;         // numeracao continua do sufixo _AD dentro do adset
}
export interface ExpandedBatch {
  campaigns: PlannedCampaign[];
  adsets: PlannedAdSet[];
  ads: PlannedAd[];
}

/**
 * Expande o plano batch em listas planas de entidades com chaves deterministas,
 * conforme o nivel de separacao. Funcao PURA (sem Meta) — base da idempotencia
 * (Contract 1) e dos testes de agrupamento.
 *
 * Total SEMPRE n*c*s*a anuncios — muda so onde os criativos se ramificam:
 *   'campaign': n*c campanhas (cada criativo isolado; c:<cr>:<ci>), s adsets cada, a ads cada.
 *   'adset':    c campanhas compartilhadas (c:-:<ci>); dentro de cada, cada criativo
 *               ganha s adsets (s:<cr>:<ci>:<si>), a ads cada.
 *   'ad':       c campanhas + s adsets compartilhados (s:-:<ci>:<si>); dentro de cada
 *               adset, cada criativo aparece como a ads (a:<cr>:<ci>:<si>:<ai>).
 * Sufixos _C/_CJ/_AD numeram CONTINUO dentro de cada pai (1-based).
 */
export function expandBatch(
  n: number,
  c: number,
  s: number,
  a: number,
  level: SeparationLevel = 'campaign'
): ExpandedBatch {
  const N = Math.max(1, Math.floor(n));
  const C = Math.max(1, Math.floor(c));
  const S = Math.max(1, Math.floor(s));
  const A = Math.max(1, Math.floor(a));

  const campaigns: PlannedCampaign[] = [];
  const adsets: PlannedAdSet[] = [];
  const ads: PlannedAd[] = [];

  if (level === 'campaign') {
    for (let cr = 0; cr < N; cr++) {
      for (let ci = 0; ci < C; ci++) {
        const campKey = `c:${cr}:${ci}`;
        campaigns.push({ key: campKey, creativeIdx: cr, campIdx: ci, campSuffixNum: ci + 1 });
        for (let si = 0; si < S; si++) {
          const adsetKey = `s:${cr}:${ci}:${si}`;
          adsets.push({ key: adsetKey, campKey, creativeIdx: cr, campIdx: ci, adsetIdx: si, setSuffixNum: si + 1 });
          for (let ai = 0; ai < A; ai++) {
            ads.push({ key: `a:${cr}:${ci}:${si}:${ai}`, adsetKey, creativeIdx: cr, campIdx: ci, adsetIdx: si, adIdx: ai, adSuffixNum: ai + 1 });
          }
        }
      }
    }
  } else if (level === 'adset') {
    for (let ci = 0; ci < C; ci++) {
      const campKey = `c:-:${ci}`;
      campaigns.push({ key: campKey, creativeIdx: null, campIdx: ci, campSuffixNum: ci + 1 });
      let setSuffix = 0; // _CJ continuo dentro da campanha (todos criativos x S)
      for (let cr = 0; cr < N; cr++) {
        for (let si = 0; si < S; si++) {
          setSuffix += 1;
          const adsetKey = `s:${cr}:${ci}:${si}`;
          adsets.push({ key: adsetKey, campKey, creativeIdx: cr, campIdx: ci, adsetIdx: si, setSuffixNum: setSuffix });
          for (let ai = 0; ai < A; ai++) {
            ads.push({ key: `a:${cr}:${ci}:${si}:${ai}`, adsetKey, creativeIdx: cr, campIdx: ci, adsetIdx: si, adIdx: ai, adSuffixNum: ai + 1 });
          }
        }
      }
    }
  } else {
    // 'ad'
    for (let ci = 0; ci < C; ci++) {
      const campKey = `c:-:${ci}`;
      campaigns.push({ key: campKey, creativeIdx: null, campIdx: ci, campSuffixNum: ci + 1 });
      for (let si = 0; si < S; si++) {
        const adsetKey = `s:-:${ci}:${si}`;
        adsets.push({ key: adsetKey, campKey, creativeIdx: null, campIdx: ci, adsetIdx: si, setSuffixNum: si + 1 });
        let adSuffix = 0; // _AD continuo dentro do adset (todos criativos x A)
        for (let cr = 0; cr < N; cr++) {
          for (let ai = 0; ai < A; ai++) {
            adSuffix += 1;
            ads.push({ key: `a:${cr}:${ci}:${si}:${ai}`, adsetKey, creativeIdx: cr, campIdx: ci, adsetIdx: si, adIdx: ai, adSuffixNum: adSuffix });
          }
        }
      }
    }
  }

  return { campaigns, adsets, ads };
}

// ────────────────────────────────────────────────────────────────────────────
// Retry-then-skip-branch (Contract 1)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Codigos de erro Meta tratados como TRANSITORIOS (vale retry com backoff):
 * 1 (desconhecido/temporario), 2 (servico indisponivel), 4 (app request limit),
 * 17 (user request limit), 341 (limite temporario), 368 (bloqueio temporario),
 * 80004 (too many calls to ad account). HTTP 429 e 5xx tambem entram aqui.
 */
const TRANSIENT_FB_CODES = new Set([1, 2, 4, 17, 341, 368, 80004]);
const RETRY_BACKOFFS_MS = [2000, 8000, 30000];

function isTransientError(err: unknown): boolean {
  if (err instanceof MetaApiError) {
    if (err.fbCode !== undefined && TRANSIENT_FB_CODES.has(err.fbCode)) return true;
    if (err.httpStatus === 429) return true;
    if (err.httpStatus !== undefined && err.httpStatus >= 500 && err.httpStatus <= 599) return true;
  }
  return false;
}

/** `Retry-After` em ms a partir de um MetaApiError; undefined se ausente/invalido. */
function retryAfterMs(err: unknown): number | undefined {
  if (err instanceof MetaApiError && err.retryAfterSec !== undefined) {
    const ms = err.retryAfterSec * 1000;
    return Number.isFinite(ms) && ms > 0 ? ms : undefined;
  }
  return undefined;
}

/**
 * `error_subcode` do objeto `error` da Meta (quando presente). Mora em `raw`,
 * não no topo do MetaApiError — `buildMetaErrorMessage` só o costura na mensagem.
 */
function errorSubcode(err: unknown): number | undefined {
  if (err instanceof MetaApiError && err.raw && typeof err.raw === 'object') {
    const sc = (err.raw as { error_subcode?: unknown }).error_subcode;
    if (typeof sc === 'number' && sc !== 0) return sc;
  }
  return undefined;
}

/**
 * Subcodes Meta que indicam um problema de PÁGINA/IDENTIDADE (não do creative em
 * si) — vale a pena tentar OUTRA página/identidade. O caso confirmado neste
 * codebase é (#100/1772103) "Instagram account missing", que é específico do par
 * Página↔IG e some ao usar uma Página que já tem IG Business / PBIA. Os demais
 * são erros de permissão/identidade de Página (não-publicável, sem acesso, etc.).
 */
const PAGE_IDENTITY_SUBCODES = new Set([
  1772103, // IG account missing (#100) — par Página/IG; trocar de Página pode resolver
  1487472, // página não disponível p/ esta conta/identidade
  1487056, // sem permissão de publicar como esta Página
  1349125, // Página/identidade inválida p/ o ad account
]);

/**
 * Decide se, ao falhar a criação do AdCreative numa Página, faz sentido AVANÇAR
 * para a próxima Página de `page_ids` (em vez de falhar o ad imediatamente).
 *
 * Só avança quando o erro é:
 *   (a) TRANSITÓRIO que escapou do retry-per-página (429/5xx/#4 etc.) — outra
 *       Página/identidade pode driblar um limite de volume por-Página/BUC; ou
 *   (b) ligado à PÁGINA/IDENTIDADE (subcode em PAGE_IDENTITY_SUBCODES).
 *
 * Para erros PERMANENTES de nível-creative (spec inválida, image_hash ruim,
 * product_set inexistente, etc.) NÃO faz sentido reenviar o MESMO creative
 * contra toda Página — multiplicaria carga/latência sob rate-limit sem chance de
 * sucesso. Nesses casos retornamos false e o caller quebra o loop na hora.
 */
function isPageRelatedError(err: unknown): boolean {
  if (isTransientError(err)) return true;
  const sc = errorSubcode(err);
  return sc !== undefined && PAGE_IDENTITY_SUBCODES.has(sc);
}

/**
 * Executa UMA mutacao Graph (create campaign/adset/creative/ad) com retry
 * exponencial em erros transitorios. Backoff 2s/8s/30s, honrando `Retry-After`
 * quando a Meta o fornecer. Esgotadas as tentativas — ou erro permanente logo
 * de cara — relanca o ultimo erro para o caller marcar a branch como falha.
 */
async function graphMutationWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_BACKOFFS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const transient = isTransientError(err);
      if (!transient || attempt === RETRY_BACKOFFS_MS.length) throw err;
      const wait = retryAfterMs(err) ?? RETRY_BACKOFFS_MS[attempt];
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

/**
 * Grau de paralelismo das mutações Graph DENTRO de uma fase (campanhas, depois
 * adsets, depois ads). Mantém ~N requests em voo para SATURAR o orçamento de
 * ~5 req/s da Meta sem ficar ocioso esperando cada round-trip (o que tornava a
 * criação latency-bound: 50 conjuntos levavam ~10 min puramente em espera).
 *
 * As fases continuam sequenciais entre si — adsets dependem de created[campKey]
 * e ads de created[adsetKey] —, então só paralelizamos itens IRMÃOS, que são
 * independentes. Erros transitórios / #4 (rate limit) ainda caem no
 * graphMutationWithRetry; se o pool estourar o limite por um instante, o backoff
 * absorve. Ajustável via env caso uma conta precise de ritmo mais conservador.
 */
const MUTATION_CONCURRENCY = Math.max(
  1,
  Math.floor(Number(process.env.CAMPAIGN_MUTATION_CONCURRENCY)) || 8
);

/**
 * Roda `worker` sobre `items` com no máximo `limit` execuções simultâneas,
 * preservando o índice original (necessário p/ a sequência de páginas por ad).
 * O `worker` é responsável pelo próprio try/catch — uma rejeição inesperada
 * propaga e aborta o pool (comportamento de "fail fast" para erros de programação;
 * erros de API já são tratados dentro de cada worker e nunca chegam aqui).
 */
async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0;
  const lanes = Math.min(Math.max(1, limit), items.length);
  const runners: Promise<void>[] = [];
  for (let lane = 0; lane < lanes; lane++) {
    runners.push(
      (async () => {
        for (;;) {
          const idx = next;
          next += 1;
          if (idx >= items.length) return;
          await worker(items[idx], idx);
        }
      })()
    );
  }
  await Promise.all(runners);
}


/**
 * Orquestrador batch — aplica multiplicadores e round-robin de páginas.
 * Emite os mesmos eventos que createFullCampaign, mas com índices ampliados
 * (campaign_index, adset_index, ad_index) pra UI poder mostrar progresso.
 *
 * Paraleliza DENTRO de cada fase (campanhas → adsets → ads) com concorrência
 * limitada (MUTATION_CONCURRENCY via runPool) — as fases permanecem sequenciais
 * porque cada nível depende dos ids do nível acima. Isso satura o orçamento de
 * ~5 req/s da Meta sem ficar ocioso esperando cada round-trip; um burst acima do
 * limite cai no backoff de graphMutationWithRetry (#4/429/5xx). Reduza
 * CAMPAIGN_MUTATION_CONCURRENCY se uma conta específica sofrer rate limit.
 */
export async function createCampaignBatch(
  input: BatchCreateInput,
  opts: BatchRunOpts
): Promise<BatchRunResult> {
  const {
    account_id,
    access_token,
    campaigns_per_creative: nCamp,
    adsets_per_campaign: nAdSet,
    ads_per_adset: nAd,
    page_ids,
    page_allocations,
    page_auto_retry,
    campaign: campaignTpl,
    adset: adsetTpl,
    creatives,
    url_tags_template,
    context,
    separation_level,
    frozen_context,
  } = input;

  const { onEvent, runState, shouldAbort } = opts;
  if (!runState.created) runState.created = {};
  if (!runState.failed) runState.failed = {};

  const level: SeparationLevel = separation_level ?? 'campaign';

  // ── Contexto de data/hora: CONGELADO no enfileiramento quando presente. ─────
  const fc = frozen_context;
  let dt = { ano: '', mes: '', dia: '', hora: '', minuto: '' };
  if (fc && (fc.ano || fc.data)) {
    const data = fc.data ?? '';
    const horaC = fc.hora_completa ?? '';
    dt = {
      ano:    fc.ano ?? data.slice(0, 4),
      mes:    fc.mes ?? data.slice(5, 7),
      dia:    fc.dia ?? data.slice(8, 10),
      hora:   fc.hora ?? horaC.slice(0, 2),
      minuto: fc.minuto ?? horaC.slice(3, 5),
    };
  } else {
    const nowLocal = toDatetimeLocal(new Date()); // 'YYYY-MM-DDTHH:mm' em GMT-3
    dt = {
      ano:    nowLocal.slice(0, 4),
      mes:    nowLocal.slice(5, 7),
      dia:    nowLocal.slice(8, 10),
      hora:   nowLocal.slice(11, 13),
      minuto: nowLocal.slice(14, 16),
    };
  }

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
    ano:                  dt.ano,
    mes:                  dt.mes,
    dia:                  dt.dia,
    hora:                 dt.hora,
    minuto:               dt.minuto,
  };

  // ── Plano determinista de entidades (chaves p/ resume idempotente). ─────────
  const plan = expandBatch(creatives.length, nCamp, nAdSet, nAd, level);

  // `counts` rastreia apenas o que ESTE run fez — usado p/ skipped (que não tem
  // mapa em runState e é por-run por design; processJob zera o baseline de skipped
  // a cada tick). NÃO use counts.created/failed como contagem final: num resume
  // após budget-abort as entidades já em runState.created são puladas ANTES de
  // counts.created += 1 (linhas dos loops abaixo), então counts só conta o que
  // este run criou — sub-contando o total real. Quem decide o número final é
  // `tally()`, que reconta a partir dos MAPAS cumulativos de runState (mesma
  // semântica de reduceCounts() em campaign-jobs-core), espelhando o que o worker
  // já persiste como autoritativo (campaign-jobs.ts) — review finding A2.
  const counts = { created: 0, failed: 0, skipped: 0 };

  // Contagem final cumulativa a partir dos mapas de runState (não do acumulador
  // por-run). Exclui chaves `m:` (AdCreatives/uploads — não são entidades-ad
  // rastreadas), idêntico a isEntityKey de reduceCounts. `skipped` permanece o
  // valor por-run (não há mapa de skipped; processJob mantém o baseline por-run).
  const isEntityKey = (k: string) => !k.startsWith('m:');
  const tally = (): { created: number; failed: number; skipped: number } => ({
    created: Object.keys(runState.created).filter(isEntityKey).length,
    failed: Object.keys(runState.failed).filter(isEntityKey).length,
    skipped: counts.skipped,
  });

  // ── Sequencia pagina-por-ad: indexada pela ORDEM dos ads no plano. ──────────
  const totalAds = plan.ads.length;
  const pageSequence: string[] = (() => {
    if (page_ids.length === 0) return [];
    const manual = page_allocations ?? {};
    const seq: string[] = [];
    for (const pid of page_ids) {
      const cnt = Math.max(0, Math.floor(manual[pid] ?? 0));
      for (let i = 0; i < cnt; i++) seq.push(pid);
    }
    const autoPool = page_ids.filter((pid) => manual[pid] === undefined);
    const rrPool = autoPool.length > 0 ? autoPool : page_ids;
    let rr = 0;
    while (seq.length < totalAds) {
      seq.push(rrPool[rr % rrPool.length]);
      rr += 1;
    }
    return seq.slice(0, totalAds);
  })();

  // {{conta}} resolve POR JOB (apelido||nome desta conta) — ver resolveEntityName.
  const contaName = contaTokenValue(baseCtx);
  const resolveName = (tplName: string, creativeName: string | null, suffix: string): string =>
    resolveEntityName(tplName, creativeName, suffix, {
      conta: contaName,
      multiCreative: creatives.length > 1,
    });

  // Aplica o envelope de mídia do contrato (CreativeMedia) ao CreativeSpec.
  // Só `source:'meta'` carrega ids já resolvidos (image_hash/video_id) — `drive`
  // ainda não foi feito upload neste ponto, então é no-op aqui (resolvido antes).
  // Tipado de ponta a ponta: `media?: CreativeMedia` no input, sem `as any`.
  const mergeMedia = (creativeSpec: CreativeSpec, media: CreativeMedia | undefined): CreativeSpec => {
    if (media && media.source === 'meta') {
      return {
        ...creativeSpec,
        image_hash: media.image_hash ?? creativeSpec.image_hash,
        video_id: media.video_id ?? creativeSpec.video_id,
        video_thumbnail_url: media.video_thumbnail_url ?? creativeSpec.video_thumbnail_url,
      };
    }
    return creativeSpec;
  };

  const created = runState.created;
  const failed = runState.failed;

  // Flag de abort cooperativo: workers param de reivindicar itens e drenam o que
  // já está em voo; ao fim de cada fase verificamos e saímos com aborted:true,
  // preservando a semântica do return-mid-loop da versão sequencial.
  let aborted = false;

  // ── 1) CAMPANHAS (irmãs em paralelo, fase com barreira antes dos adsets) ──────
  await runPool(plan.campaigns, MUTATION_CONCURRENCY, async (pc) => {
    if (shouldAbort()) { aborted = true; return; }
    if (created[pc.key]) return;

    const creativeName = pc.creativeIdx === null ? null : creatives[pc.creativeIdx].name;
    const campSuffix = nCamp > 1 ? `_C${pad2(pc.campSuffixNum)}` : '';
    const baseTplName = campaignTpl.name || creativeName || 'Campanha';
    const name = resolveName(baseTplName, creativeName, campSuffix);
    const campSpec: CampaignSpec = { ...campaignTpl, name };

    try {
      const camp = await graphMutationWithRetry(() => createCampaign(account_id, access_token, campSpec));
      // Resume retry-then-skip: este branch pode ter falhado num run anterior
      // (failed[pc.key] setado). Como NÃO há short-circuit em failed[key] (a
      // retentativa é intencional), ao suceder precisamos limpar a marca de
      // falha — senão a mesma chave fica em created E failed ao mesmo tempo e o
      // reduceCounts() do campaign-jobs-core conta as duas, inflando total e
      // reportando uma falha-fantasma. Limpar ANTES de setar created.
      delete failed[pc.key];
      created[pc.key] = camp.id;
      counts.created += 1;
      await onEvent({ kind: 'created', key: pc.key, entity: 'campaign', name, id: camp.id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed[pc.key] = msg;
      counts.failed += 1;
      await onEvent({ kind: 'failed', key: pc.key, entity: 'campaign', name, error: msg, permanent: true });
    }
  });
  if (aborted) return { aborted: true, counts: tally() };

  // ── 2) ADSETS (irmãos em paralelo; campanhas-pai já criadas pela fase 1) ──────
  await runPool(plan.adsets, MUTATION_CONCURRENCY, async (ps) => {
    if (shouldAbort()) { aborted = true; return; }
    if (created[ps.key]) return;
    if (failed[ps.campKey]) {
      counts.skipped += 1;
      await onEvent({ kind: 'skipped', key: ps.key, reason: `campanha-pai falhou (${ps.campKey})` });
      return;
    }
    const campId = created[ps.campKey];
    if (!campId) {
      counts.skipped += 1;
      await onEvent({ kind: 'skipped', key: ps.key, reason: `campanha-pai ausente (${ps.campKey})` });
      return;
    }

    const creativeName = ps.creativeIdx === null ? null : creatives[ps.creativeIdx].name;
    const setSuffix = nAdSet > 1 ? `_CJ${pad2(ps.setSuffixNum)}` : '';
    const baseTplName = adsetTpl.name || campaignTpl.name || creativeName || 'Conjunto';
    const name = resolveName(baseTplName, creativeName, setSuffix);

    // Override do product_set por creative SÓ no DPA "Nível de Campanha", em que o
    // conjunto é um adset de catálogo (template já traz product_set_id). No "Nível de
    // Anúncio" o catálogo vive só no creative e o conjunto é conversão normal — então
    // não re-injetamos product_set_id no adset (senão religaríamos o Advantage+).
    const tplHasProductSet = adsetTpl.promoted_object?.product_set_id != null;
    const overridePsid = (tplHasProductSet && ps.creativeIdx !== null)
      ? creatives[ps.creativeIdx].creative.product_set_id
      : undefined;
    const adsetSpec: AdSetSpec = {
      ...adsetTpl,
      name,
      promoted_object: overridePsid
        ? { ...adsetTpl.promoted_object, product_set_id: overridePsid }
        : adsetTpl.promoted_object,
    };

    try {
      const adset = await graphMutationWithRetry(() => createAdSet(account_id, access_token, campId, adsetSpec));
      // Limpa marca de falha de um run anterior (ver nota no loop de campanhas):
      // sem isso a chave fica em created E failed e reduceCounts() conta as duas.
      delete failed[ps.key];
      created[ps.key] = adset.id;
      counts.created += 1;
      await onEvent({ kind: 'created', key: ps.key, entity: 'adset', name, id: adset.id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed[ps.key] = msg;
      counts.failed += 1;
      await onEvent({ kind: 'failed', key: ps.key, entity: 'adset', name, error: msg, permanent: true });
    }
  });
  if (aborted) return { aborted: true, counts: tally() };

  // ── 3) ADS (creative + ad; irmãos em paralelo, conjuntos-pai já criados) ──────
  // O índice do pool É o adOrdinal — pageSequence[adOrdinal] precisa da ordem
  // original do plano, então runPool preserva o índice ao distribuir as lanes.
  await runPool(plan.ads, MUTATION_CONCURRENCY, async (pa, adOrdinal) => {
    if (shouldAbort()) { aborted = true; return; }
    if (created[pa.key]) return;

    const adsetKey = pa.adsetKey;
    const campKey = level === 'campaign' ? `c:${pa.creativeIdx}:${pa.campIdx}` : `c:-:${pa.campIdx}`;
    if (failed[adsetKey] || failed[campKey]) {
      counts.skipped += 1;
      const why = failed[adsetKey] ? `conjunto-pai falhou (${adsetKey})` : `campanha-avo falhou (${campKey})`;
      await onEvent({ kind: 'skipped', key: pa.key, reason: why });
      return;
    }
    const adsetId = created[adsetKey];
    if (!adsetId) {
      counts.skipped += 1;
      await onEvent({ kind: 'skipped', key: pa.key, reason: `conjunto-pai ausente (${adsetKey})` });
      return;
    }

    const crv = creatives[pa.creativeIdx];
    const creativeSpec = mergeMedia(crv.creative, crv.media);
    const adSuffix = nAd > 1 ? `_AD${pad2(pa.adSuffixNum)}` : '';
    const adName = `${crv.name.replace(/\{\{\s*conta\s*\}\}/gi, contaName)}${adSuffix}`;

    const primaryPage = pageSequence[adOrdinal] ?? page_ids[0];
    const pagesToTry =
      page_ids.length > 0
        ? [primaryPage, ...page_ids.filter((p) => p !== primaryPage)]
        : [creativeSpec.page_id];

    const resolvedUrlTags = url_tags_template
      ? substituteDirectAdsVars(url_tags_template, {
          ...baseCtx,
          criativo:      crv.name,
          fila:          pa.creativeIdx + 1,
          index:         pa.creativeIdx + 1,
          conjunto:      pa.adsetIdx + 1,
          adset:         pa.adsetIdx + 1,
          ad_sequencial: adOrdinal + 1,
        })
      : undefined;

    // Checkpoint do AdCreative (Contract 1 — resume idempotente). Cada ad cria
    // DUAS entidades Meta: um AdCreative e depois o Ad. Sem persistir o creative,
    // um resume APÓS createAdCreative ter sucedido mas ANTES de created[pa.key]
    // (createAd falhou de vez OU o worker estourou time-budget/lease/crashou)
    // recriaria o AdCreative — vazando um creative órfão a cada ciclo de resume.
    // Chave prefixada com `m:` (igual aos uploads de mídia) para que reduceCounts
    // a EXCLUA da contagem de entidades — um AdCreative não é entidade rastreada.
    const creativeKey = `m:cr:${pa.creativeIdx}:${pa.campIdx}:${pa.adsetIdx}:${pa.adIdx}`;
    try {
      let creativeId: string | null = created[creativeKey] ?? null;

      if (!creativeId) {
        let crCreated: { id: string } | null = null;
        let lastErr: unknown = null;
        for (const pId of pagesToTry) {
          try {
            crCreated = await graphMutationWithRetry(() =>
              createAdCreative(account_id, access_token, {
                ...creativeSpec,
                name: `${adName} — Creative`,
                page_id: pId,
                url_tags: resolvedUrlTags ?? creativeSpec.url_tags,
              })
            );
            break;
          } catch (e) {
            lastErr = e;
            // Só avança p/ a próxima Página quando o erro é ligado à Página/
            // identidade ou transitório. Um creative permanentemente quebrado
            // não vira válido em outra Página — reenviá-lo (com todo o backoff
            // transitório) contra cada page_id multiplicaria carga/latência sob
            // exatamente o rate-limit que tentamos evitar. Quebra na hora.
            if (!page_auto_retry || !isPageRelatedError(e)) throw e;
          }
        }
        if (!crCreated) throw lastErr ?? new Error('Nenhuma pagina disponivel para o creative.');
        creativeId = crCreated.id;
        // Persiste o creative ANTES do createAd: o próximo onEvent (created OU
        // failed, ambos disparam appendJobEvent que grava run_state) durabiliza
        // este checkpoint, então um resume retoma em createAd — sem recriar.
        created[creativeKey] = creativeId;
      }

      const ad = await graphMutationWithRetry(() =>
        createAd(account_id, access_token, adsetId, adName, creativeId!, 'ACTIVE')
      );
      // Limpa marca de falha de um run anterior (ver nota no loop de campanhas):
      // sem isso a chave fica em created E failed e reduceCounts() conta as duas
      // — exatamente o duplo-count que faz um ad re-sucedido virar falha-fantasma.
      delete failed[pa.key];
      created[pa.key] = ad.id;
      counts.created += 1;
      await onEvent({ kind: 'created', key: pa.key, entity: 'ad', name: adName, id: ad.id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed[pa.key] = msg;
      counts.failed += 1;
      await onEvent({ kind: 'failed', key: pa.key, entity: 'ad', name: adName, error: msg, permanent: true });
    }
  });
  if (aborted) return { aborted: true, counts: tally() };

  return { aborted: false, counts: tally() };
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
      onEvent({ type: 'creative_created', index: i + 1, id: cr.id, page_id: a.creative.page_id });

      // Ads sempre ACTIVE — herdam o estado da campanha; pausar a campanha pausa todos.
      const ad = await createAd(account_id, access_token, adsetId, a.name, cr.id, 'ACTIVE');
      adIds.push(ad.id);
      onEvent({ type: 'ad_created', index: i + 1, id: ad.id, page_id: a.creative.page_id });
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
