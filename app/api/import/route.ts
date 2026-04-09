import { NextRequest, NextResponse } from 'next/server';
import { fetchMetaMetrics } from '@/lib/meta';

// Busca cotação USD→BRL do dia
async function getUsdToBrl(): Promise<number> {
  try {
    const res = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL');
    const data = await res.json();
    const rate = parseFloat(data.USDBRL.bid);
    console.log(`[Import] Cotação USD→BRL: ${rate}`);
    return rate;
  } catch (e) {
    console.warn('[Import] Erro ao buscar cotação, usando 5.50 como fallback');
    return 5.50;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { dateFrom, dateTo, accounts, rtCampaigns, filterRegex } = body;

    if (!dateFrom || !dateTo || !accounts || !rtCampaigns) {
      return NextResponse.json({ error: 'Faltam parâmetros obrigatórios.' }, { status: 400 });
    }

    const apiKey = process.env.REDTRACK_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'REDTRACK_API_KEY não configurada.' }, { status: 500 });
    }

    const metaAccountIds: string[] = accounts.map((acc: any) => acc.account_id || acc.id);
    const rtCampaignIds: string[] = rtCampaigns.map((c: any) => c.campaign_id);
    const campaignIdParam = rtCampaignIds.join(',');

    console.log(`[Import] Meta contas: ${metaAccountIds.length}, RT campanhas: ${rtCampaignIds.length}`);

    // ============================================================
    // BUSCA CONCORRENTE — 4 fontes
    // ============================================================
    const [usdToBrl, metaResultsMatrix, rtAdData, rtCampaignData] = await Promise.all([
      // 0. Cotação USD→BRL
      getUsdToBrl(),
      // 1. Facebook: campanhas de cada conta selecionada
      Promise.all(metaAccountIds.map(accId => fetchMetaMetrics(accId, dateFrom, dateTo))),
      // 2. RedTrack: report por rt_ad (filtrado pelas campanhas RT selecionadas)
      fetch(`https://api.redtrack.io/report?api_key=${apiKey}&date_from=${dateFrom}&date_to=${dateTo}&tz=America/Sao_Paulo&group=rt_ad&campaign_id=${campaignIdParam}&per=5000`)
        .then(r => r.json()),
      // 3. RedTrack: report por rt_campaign (= nome da campanha FB, filtrado)
      fetch(`https://api.redtrack.io/report?api_key=${apiKey}&date_from=${dateFrom}&date_to=${dateTo}&tz=America/Sao_Paulo&group=rt_campaign&campaign_id=${campaignIdParam}&per=5000`)
        .then(r => r.json()),
    ]);

    let metaResults = metaResultsMatrix.flat();
    const rtAds = (Array.isArray(rtAdData) ? rtAdData : [])
      .filter((item: any) => item.rt_ad && item.rt_ad.length > 0);
    const rtCampaignsReport = Array.isArray(rtCampaignData) ? rtCampaignData : [];

    console.log(`[Import] Cotação: ${usdToBrl} | Meta: ${metaResults.length} campanhas`);
    console.log(`[Import] RT rt_ads: ${rtAds.length}, RT rt_campaigns: ${rtCampaignsReport.length}`);

    // REGEX FILTER
    if (filterRegex) {
      try {
        const regex = new RegExp(filterRegex, 'i');
        metaResults = metaResults.filter(m => regex.test(m.campaign_name));
      } catch (e) { console.warn("Invalid regex:", filterRegex); }
    }

    // ============================================================
    // INDEXAR rt_campaigns por nome para lookup rápido
    // ============================================================
    const rtCampByName: Map<string, any> = new Map();
    rtCampaignsReport.forEach((rc: any) => {
      if (rc.rt_campaign) {
        rtCampByName.set(rc.rt_campaign, rc);
      }
    });

    // ============================================================
    // MOTOR DE CRUZAMENTO
    // ============================================================
    const finalReport = rtAds.map((rtItem: any) => {
      // Escapa caracteres especiais do rt_ad para usar no Regex
      const escapedAd = rtItem.rt_ad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Regex: garante que o rt_ad não está grudado com outras letras, números, underscores ou pontos (ex: evita que LT802 pegue LT802.16 ou abcLT802)
      const exactMatchRegex = new RegExp(`(?:^|[^a-zA-Z0-9_.])` + escapedAd + `(?:[^a-zA-Z0-9_.]|$)`, 'i');

      // Campanhas Meta cujo nome contém o código exato do rt_ad
      const matchingMeta = metaResults.filter(mc => exactMatchRegex.test(mc.campaign_name));
      if (matchingMeta.length === 0) return null;

      // Para cada campanha Meta, buscar dados RT da rt_campaign correspondente
      const enrichedCampaigns = matchingMeta.map(mc => {
        const rtCamp = rtCampByName.get(mc.campaign_name);

        // Gasto: Meta spend convertido para BRL
        const spendBrl = mc.spend * usdToBrl;

        // Dados RT da rt_campaign específica (filtrada pela campanha RT selecionada)
        const rtRevenue = rtCamp ? parseFloat(rtCamp.total_revenue || '0') : 0;
        const rtConversions = rtCamp ? parseInt(rtCamp.convtype2 || '0', 10) : 0;

        return {
          campaign_id: mc.campaign_id,
          campaign_name: mc.campaign_name,
          // Meta (convertido para BRL)
          spend: spendBrl,
          impressions: mc.impressions,
          clicks: mc.clicks,
          cpm: mc.cpm * usdToBrl,
          ctr: mc.ctr,
          // RedTrack (da rt_campaign correspondente)
          revenue: rtRevenue,
          conversions: rtConversions,
          cpa: rtConversions > 0 ? spendBrl / rtConversions : 0,
          profit: rtRevenue - spendBrl,
          roas: spendBrl > 0 ? rtRevenue / spendBrl : 0,
        };
      });

      // Totais do rt_ad = soma dos filhos
      const totalSpend = enrichedCampaigns.reduce((s, c) => s + c.spend, 0);
      const totalRevenue = enrichedCampaigns.reduce((s, c) => s + c.revenue, 0);
      const totalConversions = enrichedCampaigns.reduce((s, c) => s + c.conversions, 0);
      const totalImpressions = enrichedCampaigns.reduce((s, c) => s + c.impressions, 0);
      const totalClicks = enrichedCampaigns.reduce((s, c) => s + c.clicks, 0);
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
      cost: finalReport.reduce((s: number, g: any) => s + g.cost, 0),
      revenue: finalReport.reduce((s: number, g: any) => s + g.total_revenue, 0),
      profit: finalReport.reduce((s: number, g: any) => s + g.profit, 0),
      conversions: finalReport.reduce((s: number, g: any) => s + g.total_conversions, 0),
      roas: 0,
      cpa: 0,
    };
    totals.roas = totals.cost > 0 ? totals.revenue / totals.cost : 0;
    totals.cpa = totals.conversions > 0 ? totals.cost / totals.conversions : 0;

    console.log(`[Import] Resultado: ${finalReport.length} rt_ads | Gasto: R$${totals.cost.toFixed(0)} | Receita: R$${totals.revenue.toFixed(0)} | Vendas: ${totals.conversions}`);

    return NextResponse.json({ 
      success: true, 
      data: finalReport,
      rt_totals: totals,
      exchange_rate: usdToBrl,
    });

  } catch (error: any) {
    console.error("Import Engine Error:", error);
    return NextResponse.json(
      { error: error.message || 'Erro Interno ao processar Importação.' }, 
      { status: 500 }
    );
  }
}
