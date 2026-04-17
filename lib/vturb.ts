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
