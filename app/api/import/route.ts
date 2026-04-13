import { NextRequest, NextResponse } from 'next/server';
import { fetchMetaMetrics } from '@/lib/meta';
import { fetchPaginatedRedTrack } from '@/lib/redtrack';
import { pool } from '@/lib/db';

// ============================================================
// CACHE HELPERS
// ============================================================

/**
 * TTL do cache em minutos:
 * - Datas históricas (tudo antes de hoje): 24h → dados não mudam mais
 * - Período que inclui hoje: 4h → bulk sync roda 1x/dia; "Sincronizar" força refresh
 */
function cacheTtlMinutes(_dateFrom: string, dateTo: string): number {
  const today = new Date().toISOString().split('T')[0];
  return dateTo < today ? 24 * 60 : 4 * 60;
}

async function readCache(cacheKey: string, dateFrom: string, dateTo: string, ttlMin: number): Promise<any[] | null> {
  try {
    const result = await pool.query(
      `SELECT data FROM import_cache
       WHERE cache_key = $1
         AND date_from = $2
         AND date_to   = $3
         AND synced_at > NOW() - ($4 || ' minutes')::INTERVAL`,
      [cacheKey, dateFrom, dateTo, ttlMin]
    );
    if (result.rows.length === 0) return null;
    return result.rows[0].data as any[];
  } catch {
    // Se a tabela não existir ainda, trata como cache miss silencioso
    return null;
  }
}

async function writeCache(cacheKey: string, dateFrom: string, dateTo: string, data: any[]): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO import_cache (cache_key, date_from, date_to, data, synced_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (cache_key, date_from, date_to) DO UPDATE SET
         data      = EXCLUDED.data,
         synced_at = NOW()`,
      [cacheKey, dateFrom, dateTo, JSON.stringify(data)]
    );
  } catch {
    // Falha ao escrever cache não deve quebrar o fluxo principal
  }
}

// ============================================================
// USD→BRL (sempre fresco — chamada leve, não cacheada)
// ============================================================
async function getUsdToBrl(): Promise<number> {
  try {
    const res = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL');
    const data = await res.json();
    const rate = parseFloat(data.USDBRL.bid);
    console.log(`[Import] Cotação USD→BRL: ${rate}`);
    return rate;
  } catch {
    console.warn('[Import] Erro ao buscar cotação, usando 5.50 como fallback');
    return 5.50;
  }
}

// ============================================================
// ROUTE HANDLER
// ============================================================
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { dateFrom, dateTo, accounts, rtCampaigns, filterRegex, forceRefresh } = body;

    if (!dateFrom || !dateTo || !accounts || !rtCampaigns) {
      return NextResponse.json({ error: 'Faltam parâmetros obrigatórios.' }, { status: 400 });
    }

    const apiKey = process.env.REDTRACK_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'REDTRACK_API_KEY não configurada.' }, { status: 500 });
    }

    const metaAccountIds: string[] = accounts.map((acc: any) => acc.account_id || acc.id);
    const rtCampaignIds: string[] = rtCampaigns.map((c: any) => c.campaign_id);
    const campaignIdParam = [...rtCampaignIds].sort().join(',');
    const ttl = cacheTtlMinutes(dateFrom, dateTo);

    console.log(`[Import] Meta contas: ${metaAccountIds.length}, RT campanhas: ${rtCampaignIds.length} | forceRefresh: ${!!forceRefresh}`);

    // ============================================================
    // BUSCA (cache-first) — Meta por conta, RT compartilhado
    // ============================================================

    // 1. Cotação (sempre ao vivo — chamada rápida)
    const usdToBrlPromise = getUsdToBrl();

    // 2. Meta: uma entrada de cache por (account_id, dateFrom, dateTo)
    const metaResults: any[] = [];
    const metaFetchPromises = accounts.map(async (acc: any) => {
      const accountId = acc.account_id || acc.id;
      const cacheKey = `meta:${accountId}`;

      let rows: any[] | null = forceRefresh ? null : await readCache(cacheKey, dateFrom, dateTo, ttl);

      if (rows) {
        console.log(`[Cache HIT] Meta ${accountId}: ${rows.length} campanhas`);
      } else {
        console.log(`[Cache MISS] Meta ${accountId} — buscando na API...`);
        rows = await fetchMetaMetrics(accountId, dateFrom, dateTo, acc.access_token);
        await writeCache(cacheKey, dateFrom, dateTo, rows);
      }

      metaResults.push(...rows);
    });

    // 3. RedTrack rt_ad + rt_campaign — sequencial para respeitar rate limit de 2 req/s
    const rtAdCacheKey = `rt_ad:${campaignIdParam}`;
    const rtCampCacheKey = `rt_camp:${campaignIdParam}`;
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

    const [[, usdToBrl], [rtAdsRaw, rtCampaignsReportRaw]] = await Promise.all([
      // Meta + cotação rodam em paralelo (API diferente, sem conflito de rate limit)
      Promise.all([Promise.all(metaFetchPromises), usdToBrlPromise]),

      // RT: rt_ad → delay → rt_campaign (sequencial para não disparar 429)
      (async () => {
        let rtAds: any[] | null = forceRefresh ? null : await readCache(rtAdCacheKey, dateFrom, dateTo, ttl);
        if (rtAds) {
          console.log(`[Cache HIT] RT rt_ad: ${rtAds.length} registros`);
        } else {
          console.log('[Cache MISS] RT rt_ad — buscando na API...');
          rtAds = await fetchPaginatedRedTrack(
            `https://api.redtrack.io/report?api_key=${apiKey}&date_from=${dateFrom}&date_to=${dateTo}&tz=America/Sao_Paulo&group=rt_ad&campaign_id=${campaignIdParam}`
          );
          await writeCache(rtAdCacheKey, dateFrom, dateTo, rtAds);
        }

        await delay(600);

        let rtCamps: any[] | null = forceRefresh ? null : await readCache(rtCampCacheKey, dateFrom, dateTo, ttl);
        if (rtCamps) {
          console.log(`[Cache HIT] RT rt_campaign: ${rtCamps.length} registros`);
        } else {
          console.log('[Cache MISS] RT rt_campaign — buscando na API...');
          rtCamps = await fetchPaginatedRedTrack(
            `https://api.redtrack.io/report?api_key=${apiKey}&date_from=${dateFrom}&date_to=${dateTo}&tz=America/Sao_Paulo&group=rt_campaign&campaign_id=${campaignIdParam}`
          );
          await writeCache(rtCampCacheKey, dateFrom, dateTo, rtCamps);
        }

        return [rtAds, rtCamps] as [any[], any[]];
      })(),
    ]);

    const rtAds: any[] = rtAdsRaw ?? [];
    const rtCampaignsReport: any[] = rtCampaignsReportRaw ?? [];

    // ============================================================
    // PROCESSAMENTO (igual ao original)
    // ============================================================

    // Agrupa campanhas do Meta pelo nome (soma gastos/cliques/impressões duplicados)
    const metaMap = new Map<string, any>();
    metaResults.forEach((mc: any) => {
      const name = mc.campaign_name;
      if (metaMap.has(name)) {
        const existing = metaMap.get(name);
        existing.spend += mc.spend;
        existing.impressions += mc.impressions;
        existing.clicks += mc.clicks;
      } else {
        metaMap.set(name, { ...mc });
      }
    });

    metaMap.forEach((val) => {
      if (val.impressions > 0) {
        val.cpm = (val.spend / val.impressions) * 1000;
        val.ctr = (val.clicks / val.impressions) * 100;
      }
    });

    let metaResultsFinal = Array.from(metaMap.values());
    const cleanRtAds = rtAds.filter((item: any) => item.rt_ad && item.rt_ad.length > 0);

    console.log(`[Import] Cotação: ${usdToBrl} | Meta: ${metaResultsFinal.length} campanhas`);
    console.log(`[Import] RT rt_ads: ${rtAds.length}, RT rt_campaigns: ${rtCampaignsReport.length}`);

    // Filtro regex opcional
    if (filterRegex) {
      try {
        const regex = new RegExp(filterRegex, 'i');
        metaResultsFinal = metaResultsFinal.filter(m => regex.test(m.campaign_name));
      } catch { console.warn("Invalid regex:", filterRegex); }
    }

    // Índice rt_campaigns por nome (exato)
    const rtCampByName = new Map<string, any>();
    rtCampaignsReport.forEach((rc: any) => {
      if (rc.rt_campaign) rtCampByName.set(rc.rt_campaign, rc);
    });

    // Lookup com merge: encontra match exato + qualquer entrada RT cujo nome
    // está contido no nome Meta (cobre campanhas renomeadas com prefixo "ATIVAR - " etc.)
    // e soma conversões/receita de todas as entradas encontradas.
    const findRtCamp = (metaCampaignName: string) => {
      const metaLower = metaCampaignName.toLowerCase();
      const matches: any[] = [];
      for (const [rtName, rtCamp] of rtCampByName) {
        const isExact = rtName === metaCampaignName;
        const isPartial = rtName.length > 10 && metaLower.includes(rtName.toLowerCase());
        if (isExact || isPartial) matches.push(rtCamp);
      }
      if (matches.length === 0) return null;
      if (matches.length === 1) return matches[0];
      // Mais de uma entrada: soma conversões e receita
      return {
        convtype2: String(matches.reduce((s, c) => s + parseInt(c.convtype2 || '0', 10), 0)),
        total_revenue: String(matches.reduce((s, c) => s + parseFloat(c.total_revenue || '0'), 0)),
      };
    };

    // Motor de cruzamento
    const finalReport = cleanRtAds.map((rtItem: any) => {
      const escapedAd = rtItem.rt_ad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const exactMatchRegex = new RegExp(`(?:^|[^a-zA-Z0-9_.])` + escapedAd + `(?:[^a-zA-Z0-9_.]|$)`, 'i');

      const matchingMeta = metaResultsFinal.filter(mc => exactMatchRegex.test(mc.campaign_name));
      if (matchingMeta.length === 0) return null;

      const enrichedCampaigns = matchingMeta.map(mc => {
        const rtCamp = findRtCamp(mc.campaign_name);
        const spendBrl = mc.spend * usdToBrl;
        const rtRevenue = rtCamp ? parseFloat(rtCamp.total_revenue || '0') : 0;
        const rtConversions = rtCamp ? parseInt(rtCamp.convtype2 || '0', 10) : 0;

        return {
          campaign_id: mc.campaign_id,
          campaign_name: mc.campaign_name,
          spend: spendBrl,
          impressions: mc.impressions,
          clicks: mc.clicks,
          cpm: mc.cpm * usdToBrl,
          ctr: mc.ctr,
          revenue: rtRevenue,
          conversions: rtConversions,
          cpa: rtConversions > 0 ? spendBrl / rtConversions : 0,
          profit: rtRevenue - spendBrl,
          roas: spendBrl > 0 ? rtRevenue / spendBrl : 0,
        };
      });

      const totalSpend       = enrichedCampaigns.reduce((s, c) => s + c.spend, 0);
      const totalRevenue     = enrichedCampaigns.reduce((s, c) => s + c.revenue, 0);
      const totalConversions = enrichedCampaigns.reduce((s, c) => s + c.conversions, 0);
      const totalImpressions = enrichedCampaigns.reduce((s, c) => s + c.impressions, 0);
      const totalClicks      = enrichedCampaigns.reduce((s, c) => s + c.clicks, 0);
      const avgCpm = totalImpressions > 0
        ? enrichedCampaigns.reduce((s, c) => s + (c.cpm * c.impressions), 0) / totalImpressions : 0;
      const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

      return {
        rt_ad: rtItem.rt_ad,
        cost: totalSpend,
        total_revenue: totalRevenue,
        total_conversions: totalConversions,
        cpa: totalConversions > 0 ? totalSpend / totalConversions : 0,
        profit: totalRevenue - totalSpend,
        roas: totalSpend > 0 ? totalRevenue / totalSpend : 0,
        meta_cpm: avgCpm,
        meta_ctr: avgCtr,
        meta_impressions: totalImpressions,
        meta_clicks: totalClicks,
        meta_campaigns: enrichedCampaigns,
      };
    }).filter(Boolean);

    // Totais gerais
    const totals = {
      cost:        finalReport.reduce((s: number, g: any) => s + g.cost, 0),
      revenue:     finalReport.reduce((s: number, g: any) => s + g.total_revenue, 0),
      profit:      finalReport.reduce((s: number, g: any) => s + g.profit, 0),
      conversions: finalReport.reduce((s: number, g: any) => s + g.total_conversions, 0),
      roas: 0,
      cpa: 0,
    };
    totals.roas = totals.cost > 0 ? totals.revenue / totals.cost : 0;
    totals.cpa  = totals.conversions > 0 ? totals.cost / totals.conversions : 0;

    console.log(`[Import] Resultado: ${finalReport.length} rt_ads | Gasto: R$${totals.cost.toFixed(0)} | Receita: R$${totals.revenue.toFixed(0)} | Vendas: ${totals.conversions}`);

    return NextResponse.json({
      success: true,
      data: finalReport,
      rt_totals: totals,
      exchange_rate: usdToBrl,
      from_cache: !forceRefresh,
    });

  } catch (error: any) {
    console.error("Import Engine Error:", error);
    return NextResponse.json(
      { error: error.message || 'Erro Interno ao processar Importação.' },
      { status: 500 }
    );
  }
}
