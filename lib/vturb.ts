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
    .map((p: any) => ({
      id: String(p.id ?? p.player_id ?? p._id ?? ''),
      name: p.name ?? p.title ?? p.player_name ?? null,
      ...p,
    }))
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
  const body = {
    player_id: player.id,
    start_date: dateFrom,
    end_date: dateTo,
    timezone,
  };

  const data: any = await vturbPost('/sessions/stats_by_day', token, body);

  // Possíveis formatos de resposta: array plano, { data: [...] }, { stats: [...] }.
  const rows: any[] = Array.isArray(data) ? data : (data.data ?? data.stats ?? data.days ?? []);

  return rows.map((r: any) => {
    const date = (r.date ?? r.day ?? r.start_date ?? '').slice(0, 10);
    const n = (v: any) => (v == null ? 0 : Number(v) || 0);
    return {
      date,
      player_id: player.id,
      player_name: player.name ?? null,
      total_started:    n(r.total_started ?? r.started ?? r.starts),
      total_finished:   n(r.total_finished ?? r.finished),
      total_viewed:     n(r.total_viewed ?? r.viewed ?? r.views),
      total_clicked:    n(r.total_clicked ?? r.clicked ?? r.clicks),
      unique_devices:   n(r.unique_devices ?? r.devices),
      unique_sessions:  n(r.unique_sessions ?? r.sessions),
      engagement_rate:  n(r.engagement_rate),
      play_rate:        n(r.play_rate),
      conversion_rate:  n(r.conversion_rate),
      conversions:      n(r.conversions ?? r.total_conversions),
      amount_brl:       n(r.amount_brl ?? r.amount?.BRL ?? r.amount?.brl),
      amount_usd:       n(r.amount_usd ?? r.amount?.USD ?? r.amount?.usd),
      raw: r,
    } satisfies VturbDailyMetric;
  }).filter(r => r.date);
}
