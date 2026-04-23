import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { format, subDays } from 'date-fns';
import { getUsdToBrl } from '@/lib/usd-brl';

// ============================================================
// COMBINADORES — idênticos ao /api/import
// ============================================================

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

function buildRtAdRegex(rtAd: string): RegExp {
  const escapedAd = rtAd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-zA-Z0-9_.])` + escapedAd + `(?:[^a-zA-Z0-9_.]|$)`, 'i');
}

// ============================================================
// ROUTE HANDLER (batch)
// Aceita rtAds: string[] (preferido, batch) ou rtAd: string (compat).
// - batch → { data: { [rtAd]: { [range]: {...} } } }
// - single → { data: { [range]: {...} } }
// Uma única busca ao banco, processamento por range compartilhado
// entre todos os rt_ads.
// ============================================================
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { metaAccountId, rtCampaignId } = body;
    const rtAds: string[] = Array.isArray(body.rtAds)
      ? body.rtAds.filter((x: any) => typeof x === 'string' && x.length > 0)
      : (typeof body.rtAd === 'string' ? [body.rtAd] : []);
    const isBatch = Array.isArray(body.rtAds);

    if (!metaAccountId || !rtCampaignId || rtAds.length === 0) {
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
    // BUSCA — uma vez só, independente de quantos rt_ads
    // ============================================================
    const [rtCampResult, rtCampIdResult, metaRes, usdToBrl] = await Promise.all([
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

    // Pré-compila regex por rt_ad
    const rtAdRegexes = rtAds.map(ad => ({ rtAd: ad, regex: buildRtAdRegex(ad) }));

    // Inicializa estrutura de saída
    const perRtAd: Record<string, Record<string, any>> = {};
    for (const ad of rtAds) perRtAd[ad] = {};

    // ============================================================
    // Processa cada range: maps RT/Meta construídos UMA vez por range,
    // depois itera rt_ads pra aplicar o regex e somar.
    // ============================================================
    for (const { label, dateFrom } of RANGES) {
      const rtCampRows   = rtCampResult.rows.filter((r: any)   => r.date_from >= dateFrom);
      const rtCampIdRows = rtCampIdResult.rows.filter((r: any) => r.date_from >= dateFrom);

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

      // Igual ao /api/import: soma sub3 de TODAS as campaign_ids que compartilham
      // o mesmo nome (ABO scale no Meta cria várias campanhas com nome idêntico,
      // cada uma com seu próprio sub3 no RT). Fallback por nome só se nenhuma id bateu.
      const findRevenue = (mc: { campaign_ids: string[]; campaign_name: string }) => {
        let totalRev = 0, totalConv = 0, anyHit = false;
        for (const id of mc.campaign_ids) {
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

      // Meta — agrega por campaign_name (toda a conta, igual /api/import)
      const metaMap = new Map<string, { campaign_ids: string[]; campaign_name: string; spend: number; impressions: number; clicks: number }>();
      for (const row of metaRes.rows) {
        if (row.date < dateFrom) continue;
        const name = row.campaign_name;
        if (metaMap.has(name)) {
          const existing = metaMap.get(name)!;
          existing.spend       += row.spend;
          existing.impressions += row.impressions;
          existing.clicks      += row.clicks;
          if (!existing.campaign_ids.includes(row.campaign_id)) {
            existing.campaign_ids.push(row.campaign_id);
          }
        } else {
          metaMap.set(name, {
            campaign_ids:  [row.campaign_id],
            campaign_name: row.campaign_name,
            spend:         row.spend,
            impressions:   row.impressions,
            clicks:        row.clicks,
          });
        }
      }

      // Pré-computa enriched revenue por mc (evita re-lookup entre rt_ads)
      const metaEnriched = Array.from(metaMap.values()).map(mc => {
        const spendBrl = mc.spend * usdToBrl;
        const rtCamp   = findRevenue(mc);
        const rev      = rtCamp ? parseFloat(rtCamp.total_revenue || '0') : 0;
        const conv     = rtCamp ? parseInt(rtCamp.convtype2 || '0', 10) : 0;
        return { campaign_name: mc.campaign_name, spendBrl, rev, conv };
      });

      // Por rt_ad: filtra Meta pelo regex e soma
      for (const { rtAd, regex } of rtAdRegexes) {
        let totalSpend = 0, totalRevenue = 0, totalConversions = 0;
        for (const mc of metaEnriched) {
          if (!regex.test(mc.campaign_name)) continue;
          totalSpend       += mc.spendBrl;
          totalRevenue     += mc.rev;
          totalConversions += mc.conv;
        }
        perRtAd[rtAd][label] = {
          cost:    totalSpend,
          revenue: totalRevenue,
          profit:  totalRevenue - totalSpend,
          roas:    totalSpend > 0 ? totalRevenue / totalSpend : 0,
          sales:   totalConversions,
          cpa:     totalConversions > 0 ? totalSpend / totalConversions : 0,
        };
      }
    }

    if (isBatch) {
      return NextResponse.json({ data: perRtAd });
    }
    return NextResponse.json({ data: perRtAd[rtAds[0]] });

  } catch (error: any) {
    console.error('[History Error]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
