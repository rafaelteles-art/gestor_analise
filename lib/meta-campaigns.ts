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
  | 'OUTCOME_APP_PROMOTION';

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
  pixel_id: string;
  custom_event_type: CustomEventType;
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
  /** "single" → uma imagem; "carousel" → 2-10 child_attachments */
  type: 'single' | 'carousel';
  /** ── single ── */
  link?: string;
  message?: string;
  headline?: string;
  description?: string;
  image_hash?: string;
  cta_type?: CallToActionType;
  cta_link?: string;
  /** ── carousel ── */
  child_attachments?: ChildAttachment[];
  /** forçar ordem dos cards do carrossel (true = manual) */
  multi_share_optimized?: boolean;
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

// ────────────────────────────────────────────────────────────────────────────
// Helpers internos
// ────────────────────────────────────────────────────────────────────────────

class MetaApiError extends Error {
  constructor(public step: string, public fbCode: number | undefined, message: string, public raw?: unknown) {
    super(message);
    this.name = 'MetaApiError';
  }
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
    throw new MetaApiError(step, data.error.code, data.error.message ?? 'Erro Meta', data.error);
  }
  return data as T;
}

async function getGraph<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const u = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set('access_token', token);
  const res = await fetch(u.toString());
  const data: any = await res.json();
  if (data?.error) throw new MetaApiError('GET ' + path, data.error.code, data.error.message ?? 'Erro Meta', data.error);
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

/** Lista as Páginas do Facebook que o usuário (dono do token) administra. */
export async function listPages(token: string): Promise<PageInfo[]> {
  const data = await getGraph<{ data: PageInfo[] }>(
    'me/accounts',
    token,
    { fields: 'id,name,instagram_business_account{id}', limit: '200' }
  );
  return data.data ?? [];
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
// Upload de imagem
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
    throw new MetaApiError('uploadImage', data.error.code, data.error.message ?? 'Erro Meta', data.error);
  }
  // Resposta no formato: { images: { <filename>: { hash, url } } }
  const entry = data?.images?.[filename];
  if (!entry?.hash) throw new MetaApiError('uploadImage', undefined, 'Resposta sem hash', data);
  return { hash: entry.hash as string };
}

// ────────────────────────────────────────────────────────────────────────────
// Criação dos 3 níveis (atômicos)
// ────────────────────────────────────────────────────────────────────────────

export async function createCampaign(
  accountId: string,
  token: string,
  spec: CampaignSpec
): Promise<{ id: string }> {
  const params: Record<string, unknown> = {
    name: spec.name,
    objective: spec.objective,
    status: spec.status,
    special_ad_categories: spec.special_ad_categories ?? [],
    buying_type: spec.buying_type ?? 'AUCTION',
  };
  if (spec.daily_budget_cents) params.daily_budget = spec.daily_budget_cents;
  if (spec.lifetime_budget_cents) params.lifetime_budget = spec.lifetime_budget_cents;

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

  if (c.type === 'carousel') {
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
  return postGraph<{ id: string }>(
    `${accountId}/adcreatives`,
    {
      name: c.name,
      object_story_spec: buildObjectStorySpec(c),
      // Ativa Advantage+ creative optimizations (default seguro a partir de v18+)
      degrees_of_freedom_spec: {
        creative_features_spec: { standard_enhancements: { enroll_status: 'OPT_IN' } },
      },
    },
    token,
    'createAdCreative'
  );
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
