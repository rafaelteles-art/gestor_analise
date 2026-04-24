import { getRedtrackApiKey } from './config';

export interface RedTrackMetric {
  date: string;
  campaign_id: string;
  campaign_name: string;
  clicks: number;
  conversions: number;
  total_conversions: number;
  revenue: number;
  total_revenue: number;
  cost: number;
  profit: number;
  roas: number;
}

/**
 * Função utilitária para extrair com paginação infinita a API do RedTrack.
 * Resolve o problema do limite de 1000 rows por requisição em janelas de longo período.
 */
export async function fetchPaginatedRedTrack(baseUrl: string): Promise<any[]> {
    let allData: any[] = [];
    let page = 1;
    let limit = 1000;

    while(true) {
        try {
            const url = `${baseUrl}&per=${limit}&page=${page}`;
            const res = await fetch(url, { headers: { 'Accept': 'application/json' }});
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                if (res.status === 429) {
                    // Rate limit atingido — lança erro para que o chamador saiba,
                    // ao invés de retornar silenciosamente []
                    throw new Error(`RedTrack rate limit (429): ${body}`);
                }
                console.error(`[RedTrack] HTTP ${res.status} on page ${page}: ${body}`);
                break;
            }

            const data = await res.json();
            const arr = Array.isArray(data) ? data : (data?.data || []);

            if (arr.length === 0) break;
            allData.push(...arr);

            if (arr.length < limit) break; // Chegou no fim da esteira
            page++;
        } catch (err) {
            console.error('[RedTrack Pagination Error]:', err);
            throw err; // Propaga para o rt-bulk mostrar erro real na UI
        }
    }

    return allData;
}

/**
 * Fetches RedTrack report data grouped by campaign.
 * Uses the /report endpoint with group=campaign.
 */
export async function fetchRedTrackMetrics(
  dateFrom: string,
  dateTo: string,
  campaignIds: string[]
): Promise<RedTrackMetric[]> {
  const apiKey = await getRedtrackApiKey();

  if (!apiKey) {
    console.error("RedTrack API key missing.");
    return [];
  }

  // /report com group=campaign retorna campaign_id e campaign (nome)
  const url = `https://api.redtrack.io/report?api_key=${apiKey}&date_from=${dateFrom}&date_to=${dateTo}&tz=America/Sao_Paulo&group=campaign`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "Accept": "application/json" }
    });

    if (!res.ok) {
      throw new Error(`RedTrack API error: ${res.statusText}`);
    }
    
    const data = await res.json();
    const reports = Array.isArray(data) ? data : (data.data || []);
    if (!reports || reports.length === 0) return [];

    let parsedResult: RedTrackMetric[] = reports.map((item: any) => ({
      date: dateFrom,
      campaign_id: String(item.campaign_id || ''),
      campaign_name: item.campaign || 'Unknown',
      clicks: parseInt(item.clicks || '0', 10),
      conversions: parseInt(item.conversions || '0', 10),
      total_conversions: parseInt(item.total_conversions || '0', 10),
      revenue: parseFloat(item.revenue || '0'),
      total_revenue: parseFloat(item.total_revenue || '0'),
      cost: parseFloat(item.cost || '0'),
      profit: parseFloat(item.profit || '0'),
      roas: parseFloat(item.roas || '0'),
    }));

    // Filtrar por campaigns selecionados (se especificados)
    if (campaignIds.length > 0) {
      parsedResult = parsedResult.filter(r => campaignIds.includes(r.campaign_id));
    }

    return parsedResult;
  } catch (error) {
    console.error("Failed to fetch RedTrack metrics:", error);
    return [];
  }
}

/**
 * Fetches RedTrack report data grouped by rt_ad.
 * Returns aggregated stats per rt_ad code (ex: LT1033.3).
 */
export async function fetchRedTrackByRtAd(
  dateFrom: string,
  dateTo: string
): Promise<{rt_ad: string; cost: number; profit: number; total_revenue: number; total_conversions: number; clicks: number; roas: number}[]> {
  const apiKey = await getRedtrackApiKey();

  if (!apiKey) {
    console.error("RedTrack API key missing.");
    return [];
  }

  const url = `https://api.redtrack.io/report?api_key=${apiKey}&date_from=${dateFrom}&date_to=${dateTo}&tz=America/Sao_Paulo&group=rt_ad`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "Accept": "application/json" }
    });

    if (!res.ok) {
      throw new Error(`RedTrack API error: ${res.statusText}`);
    }
    
    const data = await res.json();
    const reports = Array.isArray(data) ? data : (data.data || []);

    return reports
      .filter((item: any) => item.rt_ad && item.rt_ad.length > 0)
      .map((item: any) => ({
        rt_ad: item.rt_ad,
        cost: parseFloat(item.cost || '0'),
        profit: parseFloat(item.profit || '0'),
        total_revenue: parseFloat(item.total_revenue || '0'),
        total_conversions: parseInt(item.total_conversions || '0', 10),
        clicks: parseInt(item.clicks || '0', 10),
        roas: parseFloat(item.roas || '0'),
      }));
  } catch (error) {
    console.error("Failed to fetch RedTrack rt_ad metrics:", error);
    return [];
  }
}
