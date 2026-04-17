import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getUsdToBrl } from '@/lib/usd-brl';

// ============================================================
// COMBINADORES — agregam entradas diárias do import_cache
// ============================================================

/** Retorna códigos rt_ad distintos presentes nos dias consultados. */
function combineDailyRtAd(rows: { data: any[] }[]): { rt_ad: string }[] {
  const seen = new Set<string>();
  for (const row of rows)
    for (const entry of (row.data || []))
      if (entry.rt_ad) seen.add(entry.rt_ad);
  return Array.from(seen).map(rt_ad => ({ rt_ad }));
}

/** Soma total_revenue e convtype2 por nome de campanha RT entre os dias consultados. */
function combineDailyRtCamp(rows: { data: any[] }[]): { rt_campaign: string; total_revenue: string; convtype2: string }[] {
  const map = new Map<string, { total_revenue: number; convtype2: number }>();
  for (const row of rows) {
    for (const entry of (row.data || [])) {
      if (!entry.rt_campaign) continue;
      const cur = map.get(entry.rt_campaign) ?? { total_revenue: 0, convtype2: 0 };
      cur.total_revenue += parseFloat(entry.total_revenue || '0');
      cur.convtype2     += parseInt(entry.convtype2 || '0', 10);
      map.set(entry.rt_campaign, cur);
    }
  }
  return Array.from(map.entries()).map(([rt_campaign, v]) => ({
    rt_campaign,
    total_revenue: String(v.total_revenue),
    convtype2:     String(v.convtype2),
  }));
}

/** Soma total_revenue e convtype2 por Meta campaign_id (sub3) entre os dias consultados. */
function combineDailyRtCampById(rows: { data: any[] }[]): Map<string, { total_revenue: number; convtype2: number }> {
  const map = new Map<string, { total_revenue: number; convtype2: number }>();
  for (const row of rows) {
    for (const entry of (row.data || [])) {
      const metaId = entry.sub3;
      if (!metaId) continue;
      const cur = map.get(metaId) ?? { total_revenue: 0, convtype2: 0 };
      cur.total_revenue += parseFloat(entry.total_revenue || '0');
      cur.convtype2     += parseInt(entry.convtype2 || '0', 10);
      map.set(metaId, cur);
    }
  }
  return map;
}

// ============================================================
// ROUTE HANDLER
// Lê exclusivamente do banco de dados.
// Dados Meta vêm de meta_ads_metrics (populado pelo sync bulk).
// Dados RT vêm de import_cache (entradas diárias, populado pelo rt-bulk).
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

    // 1. Cotação USD→BRL (AwesomeAPI primário, BCB fallback, cache em DB)
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

    // 2.1. vturb: identifica players vinculados à campanha RT selecionada via rtkcmpid.
    const vturbLinkedPlayersPromise = pool.query(
      `SELECT DISTINCT player_id
       FROM vturb_utm_metrics
       WHERE query_key = 'rtkcmpid'
         AND grouped_field = ANY($3)
         AND date >= $1 AND date <= $2`,
      [dateFrom, dateTo, rtCampaignIds]
    );

    // 2.2. vturb: stats por player de vturb_metrics (pitch vem do raw JSONB).
    const vturbPlayerStatsPromise = pool.query(
      `SELECT player_id,
         SUM(total_started)                      AS total_started,
         SUM(conversions)                        AS total_conversions,
         SUM((raw->>'total_over_pitch')::bigint) AS total_over_pitch
       FROM vturb_metrics
       WHERE date >= $1 AND date <= $2
       GROUP BY player_id`,
      [dateFrom, dateTo]
    );

    // 3. RedTrack rt_ad, rt_campaign e rt_camp_id (sub3=Meta campaign_id)
    const [rtAdResult, rtCampResult, rtCampIdResult, usdToBrl] = await Promise.all([
      pool.query(
        `SELECT data FROM import_cache
         WHERE cache_key = $1
           AND date_from >= $2 AND date_from <= $3
           AND date_from = date_to
         ORDER BY date_from`,
        [`rt_ad:${campaignIdParam}`, dateFrom, dateTo]
      ),
      pool.query(
        `SELECT data FROM import_cache
         WHERE cache_key = $1
           AND date_from >= $2 AND date_from <= $3
           AND date_from = date_to
         ORDER BY date_from`,
        [`rt_camp:${campaignIdParam}`, dateFrom, dateTo]
      ),
      pool.query(
        `SELECT data FROM import_cache
         WHERE cache_key = $1
           AND date_from >= $2 AND date_from <= $3
           AND date_from = date_to
         ORDER BY date_from`,
        [`rt_camp_id:${campaignIdParam}`, dateFrom, dateTo]
      ),
      usdToBrlPromise,
    ]);

    // Combina entradas diárias
    const rtAds: any[] = combineDailyRtAd(rtAdResult.rows);
    const rtCampaignsReport: any[] = combineDailyRtCamp(rtCampResult.rows);
    const rtByMetaId = combineDailyRtCampById(rtCampIdResult.rows);

    // vturb: aguarda as duas queries (linked players + stats por player)
    const [vturbLinkedPlayers, vturbPlayerStats] = await Promise.all([
      vturbLinkedPlayersPromise,
      vturbPlayerStatsPromise,
    ]);

    // Players vinculados à campanha RT selecionada via rtkcmpid
    const linkedPlayerIds = new Set<string>(
      vturbLinkedPlayers.rows.map((r: any) => r.player_id)
    );

    // Agrega stats dos players vinculados: pitch (over_pitch), plays (started), conversões
    let vturbTotalStarted = 0;
    let vturbTotalOverPitch = 0;
    let vturbTotalConversions = 0;

    for (const r of vturbPlayerStats.rows) {
      if (!linkedPlayerIds.has(r.player_id)) continue;
      vturbTotalStarted     += Number(r.total_started)     || 0;
      vturbTotalOverPitch   += Number(r.total_over_pitch)  || 0;
      vturbTotalConversions += Number(r.total_conversions)  || 0;
    }

    // Retenção = pessoas no pitch / plays únicos
    // Conversão VT = conversões / plays únicos
    const vturbRetention = vturbTotalStarted > 0
      ? (vturbTotalOverPitch / vturbTotalStarted) * 100 : null;
    const vturbConvRate = vturbTotalStarted > 0
      ? (vturbTotalConversions / vturbTotalStarted) * 100 : null;

    console.log(`[DB] vturb rtkcmpid: ${linkedPlayerIds.size} players | started=${vturbTotalStarted} | over_pitch=${vturbTotalOverPitch} | conv=${vturbTotalConversions}`);
    console.log(`[DB] RT rt_ad: ${rtAds.length} | RT rt_camp: ${rtCampaignsReport.length} | RT rt_camp_id (sub3): ${rtByMetaId.size}`);

    // ============================================================
    // PROCESSAMENTO (igual ao original)
    // ============================================================

    // Agrupa campanhas do Meta pelo nome (soma gastos/cliques/impressões duplicados).
    // Mantém a lista de TODOS os campaign_ids que compartilham o nome — Meta com
    // frequência tem várias campanhas idênticas (escalas de ABO), e cada uma tem seu
    // próprio sub3 no RedTrack. Sem isso, o lookup por sub3 pega só a fatia da
    // primeira campaign_id e perde a receita das demais.
    const metaMap = new Map<string, any>();
    metaResults.forEach((mc: any) => {
      const name = mc.campaign_name;
      if (metaMap.has(name)) {
        const existing = metaMap.get(name);
        existing.spend       += mc.spend;
        existing.impressions += mc.impressions;
        existing.clicks      += mc.clicks;
        if (!existing.campaign_ids.includes(mc.campaign_id)) {
          existing.campaign_ids.push(mc.campaign_id);
        }
      } else {
        metaMap.set(name, { ...mc, campaign_ids: [mc.campaign_id] });
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

    // Lookup robusto: soma sub3 (Meta campaign_id) de TODAS as campanhas que
    // compartilham o nome — preserva a imunidade a renomeações e cobre o caso
    // comum de várias ad sets duplicadas no Meta com o mesmo nome. Cai no match
    // por nome só se nenhuma das ids tiver entrada no rt_camp_id.
    const findRevenue = (mc: any) => {
      const ids: string[] = mc.campaign_ids || [mc.campaign_id];
      let totalRev = 0, totalConv = 0, anyHit = false;
      for (const id of ids) {
        const byId = rtByMetaId.get(id);
        if (byId) {
          anyHit = true;
          totalRev  += byId.total_revenue;
          totalConv += byId.convtype2;
        }
      }
      if (anyHit) return { total_revenue: String(totalRev), convtype2: String(totalConv) };
      return findRtCamp(mc.campaign_name);
    };

    // Motor de cruzamento
    const finalReport = cleanRtAds.map((rtItem: any) => {
      const escapedAd = rtItem.rt_ad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const exactMatchRegex = new RegExp(`(?:^|[^a-zA-Z0-9_.])` + escapedAd + `(?:[^a-zA-Z0-9_.]|$)`, 'i');

      const matchingMeta = metaResultsFinal.filter(mc => exactMatchRegex.test(mc.campaign_name));
      if (matchingMeta.length === 0) return null;

      const enrichedCampaigns = matchingMeta.map(mc => {
        const rtCamp      = findRevenue(mc);
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
          vturb_conversion_rate: vturbConvRate,
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
        vturb_over_pitch_rate: vturbRetention,
        vturb_conversion_rate: vturbConvRate,
      };
    }).filter(Boolean);

    // Totais gerais
    const totals: any = {
      cost:        finalReport.reduce((s: number, g: any) => s + g.cost, 0),
      revenue:     finalReport.reduce((s: number, g: any) => s + g.total_revenue, 0),
      profit:      finalReport.reduce((s: number, g: any) => s + g.profit, 0),
      conversions: finalReport.reduce((s: number, g: any) => s + g.total_conversions, 0),
      roas: 0,
      cpa: 0,
      vturb_over_pitch_rate: vturbRetention,
      vturb_conversion_rate: vturbConvRate,
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
