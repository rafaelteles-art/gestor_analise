import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { format, subDays } from 'date-fns';
import { getUsdToBrl } from '@/lib/usd-brl';

// ============================================================
// COMBINADORES — espelham /api/import mas recebem linhas já
// filtradas pelo range desejado (filtragem feita no handler).
// ============================================================

function combineDailyRtAd(rows: { data: any[] }[]): { rt_ad: string }[] {
  const seen = new Set<string>();
  for (const row of rows)
    for (const entry of (row.data || []))
      if (entry.rt_ad) seen.add(entry.rt_ad);
  return Array.from(seen).map(rt_ad => ({ rt_ad }));
}

function combineDailyRtCamp(
  rows: { data: any[] }[]
): { rt_campaign: string; total_revenue: string; convtype2: string }[] {
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

function combineDailyRtCampById(
  rows: { data: any[] }[]
): Map<string, { total_revenue: number; convtype2: number }> {
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
// Replica exatamente o cruzamento do /api/import, por range,
// e depois isola o rt_ad do grupo em questão.
// ============================================================
export async function POST(req: NextRequest) {
  try {
    const { metaAccountId, rtAd, rtCampaignId } = await req.json();

    if (!metaAccountId || !rtCampaignId || !rtAd) {
      return NextResponse.json({ error: 'Parâmetros insuficientes' }, { status: 400 });
    }

    const today  = format(new Date(), 'yyyy-MM-dd');
    const d29ago = format(subDays(new Date(), 29), 'yyyy-MM-dd');

    const RANGES = [
      { label: 'Hoje',     dateFrom: today },
      { label: '2D',       dateFrom: format(subDays(new Date(), 1),  'yyyy-MM-dd') },
      { label: '3D',       dateFrom: format(subDays(new Date(), 2),  'yyyy-MM-dd') },
      { label: '7D',       dateFrom: format(subDays(new Date(), 6),  'yyyy-MM-dd') },
      { label: '14D',      dateFrom: format(subDays(new Date(), 13), 'yyyy-MM-dd') },
      { label: '30D+HOJE', dateFrom: d29ago },
    ];

    // ============================================================
    // BUSCA — tudo dos últimos 30d de uma vez, filtra por range depois
    // ============================================================
    const [rtAdResult, rtCampResult, rtCampIdResult, metaRes, usdToBrl] = await Promise.all([
      pool.query(
        `SELECT to_char(date_from, 'YYYY-MM-DD') AS date_from, data FROM import_cache
         WHERE cache_key = $1
           AND date_from >= $2
           AND date_from = date_to
         ORDER BY date_from`,
        [`rt_ad:${rtCampaignId}`, d29ago]
      ),
      pool.query(
        `SELECT to_char(date_from, 'YYYY-MM-DD') AS date_from, data FROM import_cache
         WHERE cache_key = $1
           AND date_from >= $2
           AND date_from = date_to
         ORDER BY date_from`,
        [`rt_camp:${rtCampaignId}`, d29ago]
      ),
      pool.query(
        `SELECT to_char(date_from, 'YYYY-MM-DD') AS date_from, data FROM import_cache
         WHERE cache_key = $1
           AND date_from >= $2
           AND date_from = date_to
         ORDER BY date_from`,
        [`rt_camp_id:${rtCampaignId}`, d29ago]
      ),
      pool.query(
        `SELECT campaign_id, campaign_name,
                to_char(date, 'YYYY-MM-DD') AS date,
                SUM(spend)::float       AS spend,
                SUM(impressions)::int   AS impressions,
                SUM(clicks)::int        AS clicks,
                SUM(conversions)::int   AS conversions
         FROM meta_ads_metrics
         WHERE account_id = $1
           AND date >= $2 AND date <= $3
         GROUP BY campaign_id, campaign_name, date`,
        [metaAccountId, d29ago, today]
      ),
      getUsdToBrl(today),
    ]);

    // Regex exato pro rt_ad (igual /api/import)
    const escapedAd = rtAd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exactMatchRegex = new RegExp(`(?:^|[^a-zA-Z0-9_.])` + escapedAd + `(?:[^a-zA-Z0-9_.]|$)`, 'i');

    // ============================================================
    // Processa cada range
    // ============================================================
    const finalData: Record<string, any> = {};

    for (const { label, dateFrom } of RANGES) {
      // RT — filtra linhas por dateFrom
      const rtAdRows     = rtAdResult.rows.filter((r: any)     => r.date_from >= dateFrom);
      const rtCampRows   = rtCampResult.rows.filter((r: any)   => r.date_from >= dateFrom);
      const rtCampIdRows = rtCampIdResult.rows.filter((r: any) => r.date_from >= dateFrom);

      // Confirma que o rt_ad existe no range (se não, tudo zero)
      const rtAdsInRange = combineDailyRtAd(rtAdRows);
      const hasRtAd      = rtAdsInRange.some((x: any) => x.rt_ad === rtAd);

      const rtCampaignsReport = combineDailyRtCamp(rtCampRows);
      const rtByMetaId        = combineDailyRtCampById(rtCampIdRows);

      const rtCampByName = new Map<string, any>();
      rtCampaignsReport.forEach((rc: any) => {
        if (rc.rt_campaign) rtCampByName.set(rc.rt_campaign, rc);
      });

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
      const findRevenue = (mc: { campaign_id: string; campaign_name: string }) => {
        const byId = rtByMetaId.get(mc.campaign_id);
        if (byId) return { total_revenue: String(byId.total_revenue), convtype2: String(byId.convtype2) };
        return findRtCamp(mc.campaign_name);
      };

      // Meta — agrega por campaign no range (toda a conta, igual /api/import)
      const metaByCampaign = new Map<string, { campaign_id: string; campaign_name: string; spend: number; impressions: number; clicks: number }>();
      for (const row of metaRes.rows) {
        if (row.date < dateFrom) continue;
        const key = row.campaign_name;
        const cur = metaByCampaign.get(key) ?? {
          campaign_id:   row.campaign_id,
          campaign_name: row.campaign_name,
          spend: 0, impressions: 0, clicks: 0,
        };
        cur.spend       += row.spend;
        cur.impressions += row.impressions;
        cur.clicks      += row.clicks;
        metaByCampaign.set(key, cur);
      }

      // Filtra Meta campaigns pelo regex do rt_ad e cruza
      let totalSpend = 0, totalRevenue = 0, totalConversions = 0;
      if (hasRtAd) {
        for (const mc of metaByCampaign.values()) {
          if (!exactMatchRegex.test(mc.campaign_name)) continue;
          const spendBrl = mc.spend * usdToBrl;
          const rtCamp   = findRevenue({ campaign_id: mc.campaign_id, campaign_name: mc.campaign_name });
          const rev      = rtCamp ? parseFloat(rtCamp.total_revenue || '0') : 0;
          const conv     = rtCamp ? parseInt(rtCamp.convtype2 || '0', 10) : 0;
          totalSpend       += spendBrl;
          totalRevenue     += rev;
          totalConversions += conv;
        }
      }

      finalData[label] = {
        cost:    totalSpend,
        revenue: totalRevenue,
        profit:  totalRevenue - totalSpend,
        roas:    totalSpend > 0 ? totalRevenue / totalSpend : 0,
        sales:   totalConversions,
        cpa:     totalConversions > 0 ? totalSpend / totalConversions : 0,
      };
    }

    return NextResponse.json({ data: finalData });

  } catch (error: any) {
    console.error('[History Error]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
