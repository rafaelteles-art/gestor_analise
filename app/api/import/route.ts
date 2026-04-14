import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

// ============================================================
// USD→BRL — PTAX do Banco Central do Brasil (sem rate limit)
// Tenta dateTo e recua até 5 dias para cobrir fins de semana/feriados.
// ============================================================
async function getUsdToBrl(dateTo: string): Promise<number> {
  try {
    const [year, month, day] = dateTo.split('-').map(Number);
    const base = new Date(year, month - 1, day);

    for (let i = 0; i < 5; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() - i);
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const yyyy = d.getFullYear();
      const dateStr = `${mm}-${dd}-${yyyy}`;

      const res = await fetch(
        `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarDia(dataCotacao=@dataCotacao)?@dataCotacao='${dateStr}'&$top=1&$format=json&$select=cotacaoVenda`,
        { cache: 'no-store', signal: AbortSignal.timeout(8000) }
      );
      const data = await res.json();
      if (Array.isArray(data?.value) && data.value.length > 0) {
        const rate = parseFloat(data.value[0].cotacaoVenda);
        console.log(`[Import] Cotação PTAX USD→BRL (${dateStr}): ${rate}`);
        return rate;
      }
    }
    throw new Error('Sem dados PTAX nos últimos 5 dias');
  } catch {
    console.warn('[Import] Erro ao buscar cotação PTAX, usando 5.50 como fallback');
    return 5.50;
  }
}

// ============================================================
// ROUTE HANDLER
// Lê exclusivamente do banco de dados.
// Dados Meta vêm de meta_ads_metrics (populado pelo sync bulk).
// Dados RT vêm de import_cache (populado pelo rt-bulk sync).
// Para forçar atualização dos dados, use Configurações → Sincronizar.
// ============================================================
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { dateFrom, dateTo, accounts, rtCampaigns, filterRegex } = body;

    if (!dateFrom || !dateTo || !accounts || !rtCampaigns) {
      return NextResponse.json({ error: 'Faltam parâmetros obrigatórios.' }, { status: 400 });
    }

    const rtCampaignIds: string[] = rtCampaigns.map((c: any) => c.campaign_id);
    const campaignIdParam = [...rtCampaignIds].sort().join(',');

    console.log(`[Import] Meta contas: ${accounts.length}, RT campanhas: ${rtCampaignIds.length} | Fonte: banco de dados`);

    // ============================================================
    // BUSCA — tudo vem do banco, sem chamadas à API Meta ou RT
    // ============================================================

    // 1. Cotação USD→BRL (awesomeapi — terceiro leve, não Meta/RT)
    const usdToBrlPromise = getUsdToBrl(dateTo);

    // 2. Meta: agrega meta_ads_metrics pelo período selecionado
    const metaResults: any[] = [];
    await Promise.all(accounts.map(async (acc: any) => {
      const accountId = acc.account_id || acc.id;

      const result = await pool.query(
        `SELECT
           campaign_id,
           campaign_name,
           SUM(spend)       AS spend,
           SUM(impressions) AS impressions,
           SUM(clicks)      AS clicks,
           SUM(conversions) AS conversions
         FROM meta_ads_metrics
         WHERE account_id = $1
           AND date >= $2
           AND date <= $3
         GROUP BY campaign_id, campaign_name`,
        [accountId, dateFrom, dateTo]
      );

      console.log(`[DB] Meta ${accountId}: ${result.rows.length} campanhas (${dateFrom} → ${dateTo})`);

      metaResults.push(...result.rows.map((row: any) => {
        const impressions = parseInt(row.impressions, 10);
        const clicks      = parseInt(row.clicks, 10);
        const spend       = parseFloat(row.spend);
        return {
          account_id:    accountId,
          campaign_id:   row.campaign_id,
          campaign_name: row.campaign_name,
          spend,
          impressions,
          clicks,
          conversions:   parseInt(row.conversions, 10),
          ctr:           impressions > 0 ? (clicks / impressions) * 100 : 0,
          cpm:           impressions > 0 ? (spend / impressions) * 1000 : 0,
        };
      }));
    }));

    // 3. RedTrack rt_ad e rt_campaign — lidos do import_cache
    const [rtAdResult, rtCampResult, usdToBrl] = await Promise.all([
      pool.query(
        `SELECT data FROM import_cache
         WHERE cache_key = $1 AND date_from = $2 AND date_to = $3
         ORDER BY synced_at DESC LIMIT 1`,
        [`rt_ad:${campaignIdParam}`, dateFrom, dateTo]
      ),
      pool.query(
        `SELECT data FROM import_cache
         WHERE cache_key = $1 AND date_from = $2 AND date_to = $3
         ORDER BY synced_at DESC LIMIT 1`,
        [`rt_camp:${campaignIdParam}`, dateFrom, dateTo]
      ),
      usdToBrlPromise,
    ]);

    const rtAds: any[]            = rtAdResult.rows.length  > 0 ? rtAdResult.rows[0].data  : [];
    const rtCampaignsReport: any[] = rtCampResult.rows.length > 0 ? rtCampResult.rows[0].data : [];

    console.log(`[DB] RT rt_ad: ${rtAds.length} registros | RT rt_campaign: ${rtCampaignsReport.length} registros`);

    // ============================================================
    // PROCESSAMENTO (igual ao original)
    // ============================================================

    // Agrupa campanhas do Meta pelo nome (soma gastos/cliques/impressões duplicados)
    const metaMap = new Map<string, any>();
    metaResults.forEach((mc: any) => {
      const name = mc.campaign_name;
      if (metaMap.has(name)) {
        const existing = metaMap.get(name);
        existing.spend       += mc.spend;
        existing.impressions += mc.impressions;
        existing.clicks      += mc.clicks;
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

    console.log(`[Import] Cotação: ${usdToBrl} | Meta: ${metaResultsFinal.length} campanhas | RT rt_ads: ${cleanRtAds.length}`);

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
    const findRtCamp = (metaCampaignName: string) => {
      const metaLower = metaCampaignName.toLowerCase();
      const matches: any[] = [];
      for (const [rtName, rtCamp] of rtCampByName) {
        const isExact   = rtName === metaCampaignName;
        const isPartial = rtName.length > 10 && metaLower.includes(rtName.toLowerCase());
        if (isExact || isPartial) matches.push(rtCamp);
      }
      if (matches.length === 0) return null;
      if (matches.length === 1) return matches[0];
      return {
        convtype2:     String(matches.reduce((s, c) => s + parseInt(c.convtype2    || '0', 10), 0)),
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
        const rtCamp      = findRtCamp(mc.campaign_name);
        const spendBrl    = mc.spend * usdToBrl;
        const rtRevenue   = rtCamp ? parseFloat(rtCamp.total_revenue || '0') : 0;
        const rtConversions = rtCamp ? parseInt(rtCamp.convtype2 || '0', 10) : 0;

        return {
          campaign_id:   mc.campaign_id,
          campaign_name: mc.campaign_name,
          spend:         spendBrl,
          impressions:   mc.impressions,
          clicks:        mc.clicks,
          cpm:           mc.cpm * usdToBrl,
          ctr:           mc.ctr,
          revenue:       rtRevenue,
          conversions:   rtConversions,
          cpa:           rtConversions > 0 ? spendBrl / rtConversions : 0,
          profit:        rtRevenue - spendBrl,
          roas:          spendBrl > 0 ? rtRevenue / spendBrl : 0,
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
        rt_ad:             rtItem.rt_ad,
        cost:              totalSpend,
        total_revenue:     totalRevenue,
        total_conversions: totalConversions,
        cpa:               totalConversions > 0 ? totalSpend / totalConversions : 0,
        profit:            totalRevenue - totalSpend,
        roas:              totalSpend > 0 ? totalRevenue / totalSpend : 0,
        meta_cpm:          avgCpm,
        meta_ctr:          avgCtr,
        meta_impressions:  totalImpressions,
        meta_clicks:       totalClicks,
        meta_campaigns:    enrichedCampaigns,
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
    });

  } catch (error: any) {
    console.error("Import Engine Error:", error);
    return NextResponse.json(
      { error: error.message || 'Erro Interno ao processar Importação.' },
      { status: 500 }
    );
  }
}
