/**
 * Cliente para a API oficial de Analytics do vturb.
 * https://vturb.gitbook.io/analytics-api/
 *
 * Autenticação via headers:
 *   X-Api-Token: <token>
 *   X-Api-Version: v1
 *
 * Base: https://analytics.vturb.net
 */

const VTURB_BASE = 'https://analytics.vturb.net';
const API_VERSION = 'v1';
const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

export interface VturbPlayer {
  id: string;
  name?: string;
  video_duration?: number;
  pitch_time?: number;
  [key: string]: any;
}

/** Linha diária normalizada salva em vturb_metrics. */
export interface VturbDailyMetric {
  date: string;             // yyyy-MM-dd
  player_id: string;
  player_name: string | null;
  total_started: number;
  total_finished: number;
  total_viewed: number;
  total_clicked: number;
  unique_devices: number;
  unique_sessions: number;
  engagement_rate: number;
  play_rate: number;
  conversion_rate: number;
  conversions: number;
  amount_brl: number;
  amount_usd: number;
  raw: any;
}

function headers(token: string): HeadersInit {
  return {
    'X-Api-Token': token,
    'X-Api-Version': API_VERSION,
    'Content-Type': 'application/json',
  };
}

async function vturbPost<T = any>(path: string, token: string, body: any): Promise<T> {
  const res = await fetch(`${VTURB_BASE}${path}`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify(body),
  });

  if (res.status === 429) {
    throw new Error('vturb rate limit (429). Tente novamente em instantes.');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`vturb ${path} → ${res.status}: ${text || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function vturbGet<T = any>(path: string, token: string): Promise<T> {
  const res = await fetch(`${VTURB_BASE}${path}`, {
    method: 'GET',
    headers: headers(token),
  });

  if (res.status === 429) {
    throw new Error('vturb rate limit (429). Tente novamente em instantes.');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`vturb ${path} → ${res.status}: ${text || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/** GET /players/list — lista de players da company. */
export async function fetchVturbPlayers(token: string): Promise<VturbPlayer[]> {
  const data: any = await vturbGet('/players/list', token);
  // A API pode retornar { players: [...] } ou um array direto.
  const list: any[] = Array.isArray(data) ? data : (data.players ?? data.data ?? []);
  return list
    .map((p: any) => {
      const durRaw = p.video_duration ?? p.duration ?? p.video_length ?? p.length;
      const dur = Number(durRaw);
      const pt = Number(p.pitch_time ?? p.pitchTime ?? 0);
      return {
        ...p,
        id: String(p.id ?? p.player_id ?? p._id ?? ''),
        name: p.name ?? p.title ?? p.player_name ?? null,
        video_duration: Number.isFinite(dur) && dur > 0 ? Math.round(dur) : undefined,
        pitch_time: Number.isFinite(pt) && pt > 0 ? Math.round(pt) : undefined,
      };
    })
    .filter((p: VturbPlayer) => p.id);
}

/**
 * Busca estatísticas diárias de um player (sessions/stats_by_day) dentro do
 * intervalo informado e normaliza para linhas por (date, player_id).
 *
 * As respostas da API variam um pouco entre endpoints — por isso guardamos a
 * resposta crua em `raw` e extraímos os campos comuns por optional chaining.
 */
export async function fetchVturbPlayerDaily(
  token: string,
  player: VturbPlayer,
  dateFrom: string,
  dateTo: string,
  timezone: string = DEFAULT_TIMEZONE,
): Promise<VturbDailyMetric[]> {
  // A API exige datetime com horas/minutos/segundos (formato "YYYY-MM-DD HH:MM:SS").
  // Cobrimos o dia inteiro: 00:00:00 → 23:59:59.
  const startDateTime = `${dateFrom.slice(0, 10)} 00:00:00`;
  const endDateTime   = `${dateTo.slice(0, 10)} 23:59:59`;

  const body = {
    player_id: player.id,
    start_date: startDateTime,
    end_date: endDateTime,
    timezone,
  };

  const data: any = await vturbPost('/sessions/stats_by_day', token, body);

  // Possíveis formatos de resposta: array plano, { data: [...] }, { stats: [...] }.
  const rows: any[] = Array.isArray(data) ? data : (data.data ?? data.stats ?? data.days ?? []);

  return rows.map((r: any) => {
    const date = String(r.date_key ?? r.date ?? r.day ?? r.start_date ?? '').slice(0, 10);
    const n = (v: any) => (v == null ? 0 : Number(v) || 0);
    return {
      date,
      player_id: player.id,
      player_name: player.name ?? null,
      total_started:    n(r.total_started ?? r.started ?? r.starts),
      total_finished:   n(r.total_finished ?? r.finished),
      total_viewed:     n(r.total_viewed ?? r.viewed ?? r.views),
      total_clicked:    n(r.total_clicked ?? r.clicked ?? r.clicks),
      unique_devices:   n(r.total_viewed_device_uniq ?? r.unique_devices ?? r.devices),
      unique_sessions:  n(r.total_viewed_session_uniq ?? r.unique_sessions ?? r.sessions),
      engagement_rate:  n(r.engagement_rate),
      play_rate:        n(r.play_rate),
      conversion_rate:  n(r.overall_conversion_rate ?? r.conversion_rate),
      conversions:      n(r.total_conversions ?? r.conversions),
      amount_brl:       n(r.total_amount_brl ?? r.amount_brl ?? r.amount?.BRL ?? r.amount?.brl),
      amount_usd:       n(r.total_amount_usd ?? r.amount_usd ?? r.amount?.USD ?? r.amount?.usd),
      raw: r,
    } satisfies VturbDailyMetric;
  }).filter(r => r.date);
}

/** Linha diária normalizada por (date, player_id, query_key, grouped_field) para vturb_utm_metrics. */
export interface VturbUtmDailyMetric {
  date: string;
  player_id: string;
  query_key: string;      // utm_content | utm_campaign | ...
  grouped_field: string;  // valor do utm
  total_started: number;
  total_viewed: number;
  total_finished: number;
  total_over_pitch: number;
  total_under_pitch: number;
  total_conversions: number;
  over_pitch_rate: number;
  overall_conversion_rate: number;
  amount_brl: number;
  amount_usd: number;
  raw: any;
}

/**
 * POST /traffic_origin/stats_by_day — estatísticas por dia agrupadas por uma
 * ou mais query keys (ex.: utm_content, utm_campaign). Devolve, para cada dia,
 * múltiplas linhas (uma por grouped_field encontrado).
 *
 * https://vturb.gitbook.io/analytics-api/
 */
export async function fetchVturbPlayerUtmDaily(
  token: string,
  player: VturbPlayer,
  queryKeys: string[],
  dateFrom: string,
  dateTo: string,
  timezone: string = DEFAULT_TIMEZONE,
  videoDuration: number = 0,
): Promise<VturbUtmDailyMetric[]> {
  const startDateTime = `${dateFrom.slice(0, 10)} 00:00:00`;
  const endDateTime   = `${dateTo.slice(0, 10)} 23:59:59`;

  // video_duration na API = threshold do pitch (segundos que o vídeo precisa
  // ser assistido pra contar como "over pitch"). Prioridade:
  //   1. pitch_time do player (configurado no vturb)
  //   2. videoDuration passado pelo chamador
  //   3. video_duration do player (duração total do vídeo)
  //   4. fallback 1 (last resort — resulta em ~100% over_pitch, valor inútil)
  const resolvedDuration =
    (player.pitch_time && player.pitch_time > 0) ? player.pitch_time
    : videoDuration > 0 ? videoDuration
    : (player.video_duration && player.video_duration > 0 ? player.video_duration : 1);

  const body: Record<string, any> = {
    player_id: player.id,
    start_date: startDateTime,
    end_date: endDateTime,
    query_keys: queryKeys,
    timezone,
    video_duration: resolvedDuration,
  };

  console.log(`[vturb] UTM request → video_duration=${resolvedDuration}, player=${player.id}`);
  const data: any = await vturbPost('/traffic_origin/stats_by_day', token, body);

  const rows: any[] = Array.isArray(data) ? data : (data.data ?? data.stats ?? data.days ?? []);
  // Debug: log primeiro row cru para verificar campos de pitch
  if (rows.length > 0) {
    const sample = rows[0];
    console.log(`[vturb] UTM sample raw → over_pitch=${sample.total_over_pitch}, under_pitch=${sample.total_under_pitch}, over_pitch_rate=${sample.over_pitch_rate}, keys=${Object.keys(sample).join(',')}`);
  }
  const n = (v: any) => (v == null ? 0 : Number(v) || 0);

  return rows.map((r: any) => {
    const date = String(r.date_key ?? r.date ?? r.day ?? '').slice(0, 10);
    return {
      date,
      player_id: player.id,
      query_key: String(r.query_key ?? ''),
      grouped_field: String(r.grouped_field ?? ''),
      total_started:           n(r.total_started),
      total_viewed:            n(r.total_viewed),
      total_finished:          n(r.total_finished),
      total_over_pitch:        n(r.total_over_pitch),
      total_under_pitch:       n(r.total_under_pitch),
      total_conversions:       n(r.total_conversions),
      over_pitch_rate:         n(r.over_pitch_rate),
      overall_conversion_rate: n(r.overall_conversion_rate),
      amount_brl:              n(r.total_amount_brl ?? r.amount_brl),
      amount_usd:              n(r.total_amount_usd ?? r.amount_usd),
      raw: r,
    } satisfies VturbUtmDailyMetric;
  }).filter(r => r.date && r.query_key && r.grouped_field);
}

// ============================================================
// Fluxo por campanha (doc vturb-retencao-por-campanha.md)
// 1. /events/total_by_company_players — filtra players ativos
// 2. /traffic_origin/stats              — totais por utm_campaign (período)
// 3. Extrai campaign_id de "nome|campaign_id"
// 4. Agrega por campaign_id
// ============================================================

export interface VturbCampaignStats {
  grouped_field: string;
  total_viewed: number;
  total_viewed_device_uniq: number;
  total_started: number;
  total_over_pitch: number;
  total_clicked: number;
  total_clicked_device_uniq: number;
  total_conversions: number;
}

export interface VturbAggregatedCampaign {
  total_viewed: number;
  total_viewed_uniq: number;     // visualizações únicas (por device)
  total_started: number;
  total_over_pitch: number;
  total_clicked: number;
  total_clicked_uniq: number;
  total_conversions: number;     // compras reais
  play_rate: number;             // started / viewed
  over_pitch_rate: number;       // over_pitch / started (retenção)
  conversion_rate: number;       // conversions / viewed_uniq (conversão real)
}

/**
 * Normaliza nome de campanha para matching entre Meta (espaços normais) e
 * vturb (utm_campaign vem com `+` no lugar dos espaços, às vezes %20).
 * Também aplica lower/trim — matching é case-insensitive.
 */
export function normalizeCampaignName(raw: string): string {
  if (!raw) return '';
  let s = String(raw).replace(/\+/g, ' ');
  try { s = decodeURIComponent(s); } catch { /* deixa como está se tiver % solto */ }
  return s.trim().toLowerCase();
}

/**
 * POST /events/total_by_company_players — devolve players com viewed > 0
 * no período. Evita fan-out desnecessário pra players inativos.
 */
export async function fetchVturbActivePlayerIds(
  token: string,
  players: VturbPlayer[],
  dateFrom: string,
  dateTo: string,
): Promise<Set<string>> {
  if (players.length === 0) return new Set();
  const body = {
    events: ['viewed'],
    start_date: dateFrom.slice(0, 10),
    end_date:   dateTo.slice(0, 10),
    players_start_date: players.map((p) => ({
      player_id: p.id,
      start_date: dateFrom.slice(0, 10),
    })),
  };
  // A API aceita um payload grande em princípio, mas já vimos falhas silenciosas
  // com ~1700 players — batch pra garantir.
  const BATCH = 100;
  const active = new Set<string>();
  for (let i = 0; i < players.length; i += BATCH) {
    const slice = players.slice(i, i + BATCH);
    const batchBody = {
      ...body,
      players_start_date: slice.map((p) => ({ player_id: p.id, start_date: dateFrom.slice(0, 10) })),
    };
    const data: any = await vturbPost('/events/total_by_company_players', token, batchBody);
    const rows: any[] = Array.isArray(data) ? data : (data.data ?? data.players ?? data.stats ?? []);
    for (const r of rows) {
      const pid = String(r.player_id ?? r.id ?? '');
      // Campo real devolvido pelo endpoint: `total` (não `total_viewed`).
      const viewed = Number(r.total ?? r.total_viewed ?? r.viewed ?? r.count ?? 0);
      if (pid && viewed > 0) active.add(pid);
    }
  }
  return active;
}

/**
 * POST /traffic_origin/stats — totais do período por query_key.
 * Diferente de /traffic_origin/stats_by_day, este devolve total_over_pitch
 * correto por grouped_field.
 */
export async function fetchVturbPlayerCampaignStats(
  token: string,
  player: VturbPlayer,
  dateFrom: string,
  dateTo: string,
  timezone: string = DEFAULT_TIMEZONE,
): Promise<VturbCampaignStats[]> {
  const startDateTime = `${dateFrom.slice(0, 10)} 00:00:00`;
  const endDateTime   = `${dateTo.slice(0, 10)} 23:59:59`;
  const body: Record<string, any> = {
    player_id: player.id,
    start_date: startDateTime,
    end_date: endDateTime,
    query_key: 'utm_campaign',
    timezone,
  };
  if (player.video_duration && player.video_duration > 0) body.video_duration = player.video_duration;
  if (player.pitch_time && player.pitch_time > 0)         body.pitch_time     = player.pitch_time;

  const data: any = await vturbPost('/traffic_origin/stats', token, body);
  const rows: any[] = Array.isArray(data) ? data : (data.data ?? data.stats ?? []);
  const n = (v: any) => (v == null ? 0 : Number(v) || 0);
  return rows.map((r: any) => ({
    grouped_field: String(r.grouped_field ?? ''),
    total_viewed:              n(r.total_viewed),
    total_viewed_device_uniq:  n(r.total_viewed_device_uniq),
    total_started:             n(r.total_started),
    total_over_pitch:          n(r.total_over_pitch),
    total_clicked:             n(r.total_clicked),
    total_clicked_device_uniq: n(r.total_clicked_device_uniq),
    total_conversions:         n(r.total_conversions),
  })).filter(r => r.grouped_field);
}

// Cache em memória por (dateFrom, dateTo). TTL 10min — aceitável pra um
// dashboard que consulta várias vezes com o mesmo range.
const CAMPAIGN_MAP_TTL_MS = 10 * 60 * 1000;
const campaignMapCache = new Map<string, { data: Record<string, VturbAggregatedCampaign>; expiry: number }>();

/**
 * Orquestra o fluxo completo:
 *  - /players/list
 *  - /events/total_by_company_players   (filtra ativos)
 *  - /traffic_origin/stats por player   (concorrência 5, Promise.allSettled)
 *  - Agrega por NOME de campanha (normalizado: `+` → espaço, lower/trim).
 * Retorna Record keyed by nome normalizado — o `grouped_field` do vturb é o
 * próprio utm_campaign, que aqui é só o nome da campanha do Meta.
 */
export async function buildVturbCampaignMap(
  token: string,
  dateFrom: string,
  dateTo: string,
): Promise<Record<string, VturbAggregatedCampaign>> {
  const cacheKey = `${dateFrom}__${dateTo}`;
  const now = Date.now();
  const cached = campaignMapCache.get(cacheKey);
  if (cached && now < cached.expiry) return cached.data;

  const allPlayers = (await fetchVturbPlayers(token))
    .filter((p) => (p.video_duration ?? 0) > 0); // ignora placeholders/test

  const activeIds = await fetchVturbActivePlayerIds(token, allPlayers, dateFrom, dateTo);
  const activePlayers = allPlayers.filter((p) => activeIds.has(p.id));

  const CONCURRENCY = 5;
  const collected: VturbCampaignStats[] = [];
  for (let i = 0; i < activePlayers.length; i += CONCURRENCY) {
    const batch = activePlayers.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((p) => fetchVturbPlayerCampaignStats(token, p, dateFrom, dateTo)),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') collected.push(...r.value);
      else console.warn('[vturb] traffic_origin/stats falhou:', r.reason?.message ?? r.reason);
    }
  }

  type Acc = {
    total_viewed: number; total_viewed_uniq: number;
    total_started: number; total_over_pitch: number;
    total_clicked: number; total_clicked_uniq: number;
    total_conversions: number;
  };
  const byCampaign = new Map<string, Acc>();
  for (const row of collected) {
    const key = normalizeCampaignName(row.grouped_field);
    if (!key) continue;
    const cur = byCampaign.get(key) ?? {
      total_viewed: 0, total_viewed_uniq: 0,
      total_started: 0, total_over_pitch: 0,
      total_clicked: 0, total_clicked_uniq: 0,
      total_conversions: 0,
    };
    cur.total_viewed       += row.total_viewed;
    cur.total_viewed_uniq  += row.total_viewed_device_uniq;
    cur.total_started      += row.total_started;
    cur.total_over_pitch   += row.total_over_pitch;
    cur.total_clicked      += row.total_clicked;
    cur.total_clicked_uniq += row.total_clicked_device_uniq;
    cur.total_conversions  += row.total_conversions;
    byCampaign.set(key, cur);
  }

  const out: Record<string, VturbAggregatedCampaign> = {};
  for (const [key, a] of byCampaign) {
    out[key] = {
      ...a,
      play_rate:       a.total_viewed      > 0 ? (a.total_started     / a.total_viewed)      * 100 : 0,
      over_pitch_rate: a.total_started     > 0 ? (a.total_over_pitch  / a.total_started)     * 100 : 0,
      conversion_rate: a.total_viewed_uniq > 0 ? (a.total_conversions / a.total_viewed_uniq) * 100 : 0,
    };
  }

  campaignMapCache.set(cacheKey, { data: out, expiry: now + CAMPAIGN_MAP_TTL_MS });
  return out;
}
