import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { format, subDays } from 'date-fns';
import { matchRtCampaignCost, type RtAgg } from '@/lib/redtrack-cost';

// ============================================================
// Regex por rt_ad — igual ao /api/import
// ============================================================
function buildRtAdRegex(rtAd: string): RegExp {
  const escapedAd = rtAd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-zA-Z0-9_.])` + escapedAd + `(?:[^a-zA-Z0-9_.]|$)`, 'i');
}

type AggRow = {
  date: string;
  key: string;
  total_revenue: number;
  convtype2: number;
  cost: number;
};

// Agrega rows unnested por chave, filtrando por date >= dateFrom.
function aggregateByKey(rows: AggRow[], dateFrom: string): Map<string, RtAgg> {
  const map = new Map<string, RtAgg>();
  for (const r of rows) {
    if (r.date < dateFrom) continue;
    const cur = map.get(r.key);
    if (cur) {
      cur.total_revenue += r.total_revenue;
      cur.convtype2     += r.convtype2;
      cur.cost          += r.cost;
    } else {
      map.set(r.key, { total_revenue: r.total_revenue, convtype2: r.convtype2, cost: r.cost });
    }
  }
  return map;
}

// ============================================================
// ROUTE HANDLER (batch)
// Aceita rtAds: string[] (preferido, batch) ou rtAd: string (compat).
// - batch → { data: { [rtAd]: { [range]: {...} } } }
// - single → { data: { [range]: {...} } }
//
// Memory-efficient: unnest JSONB no Postgres e retorna só os 4 campos
// necessários (date, chave, total_revenue, convtype2). Evita carregar
// arrays JSONB grandes no heap do Node.
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
    // BUSCA — unnest em SQL, rows planas e compactas
    // ============================================================
    const [rtCampFlat, rtCampIdFlat, metaRes] = await Promise.all([
      pool.query<AggRow>(
        `SELECT
           to_char(ic.date_from, 'YYYY-MM-DD')                           AS date,
           entry->>'rt_campaign'                                         AS key,
           COALESCE(NULLIF(entry->>'total_revenue', '')::float, 0)       AS total_revenue,
           COALESCE(NULLIF(entry->>'convtype2',     '')::int,   0)       AS convtype2,
           COALESCE(NULLIF(entry->>'cost',          '')::float, 0)       AS cost
         FROM import_cache ic,
              jsonb_array_elements(ic.data) entry
         WHERE ic.cache_key = $1
           AND ic.date_from >= $2
           AND ic.date_from = ic.date_to
           AND entry->>'rt_campaign' IS NOT NULL
           AND entry->>'rt_campaign' <> ''`,
        [`rt_camp:${rtCampaignId}`, d29ago]
      ),
      pool.query<AggRow>(
        `SELECT
           to_char(ic.date_from, 'YYYY-MM-DD')                           AS date,
           entry->>'sub3'                                                AS key,
           COALESCE(NULLIF(entry->>'total_revenue', '')::float, 0)       AS total_revenue,
           COALESCE(NULLIF(entry->>'convtype2',     '')::int,   0)       AS convtype2,
           COALESCE(NULLIF(entry->>'cost',          '')::float, 0)       AS cost
         FROM import_cache ic,
              jsonb_array_elements(ic.data) entry
         WHERE ic.cache_key = $1
           AND ic.date_from >= $2
           AND ic.date_from = ic.date_to
           AND entry->>'sub3' IS NOT NULL
           AND entry->>'sub3' <> ''`,
        [`rt_camp_id:${rtCampaignId}`, d29ago]
      ),
      pool.query(
        `SELECT campaign_id, campaign_name,
                to_char(date, 'YYYY-MM-DD') AS date
         FROM meta_ads_metrics
         WHERE account_id = $1
           AND date >= $2 AND date <= $3
         GROUP BY campaign_id, campaign_name, date`,
        [metaAccountId, d29ago, today]
      ),
    ]);

    const rtCampRows   = rtCampFlat.rows;
    const rtCampIdRows = rtCampIdFlat.rows;

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
      const rtCampByName = aggregateByKey(rtCampRows,   dateFrom); // Map<name, RtAgg>
      const rtByMetaId   = aggregateByKey(rtCampIdRows, dateFrom); // Map<sub3, RtAgg>

      // Meta — agrega por campaign_name (toda a conta, igual /api/import)
      const metaMap = new Map<string, { campaign_ids: string[]; campaign_name: string }>();
      for (const row of metaRes.rows) {
        if (row.date < dateFrom) continue;
        const name = row.campaign_name;
        const existing = metaMap.get(name);
        if (existing) {
          if (!existing.campaign_ids.includes(row.campaign_id)) {
            existing.campaign_ids.push(row.campaign_id);
          }
        } else {
          metaMap.set(name, { campaign_ids: [row.campaign_id], campaign_name: name });
        }
      }

      // Por campanha: custo, receita e conversões vêm todos da mesma rt_campaign.
      const metaEnriched: { campaign_name: string; cost: number; rev: number; conv: number }[] = [];
      for (const mc of metaMap.values()) {
        const rtCamp = matchRtCampaignCost(mc, rtByMetaId, rtCampByName);
        metaEnriched.push({
          campaign_name: mc.campaign_name,
          cost: rtCamp ? rtCamp.cost          : 0,
          rev:  rtCamp ? rtCamp.total_revenue : 0,
          conv: rtCamp ? rtCamp.convtype2     : 0,
        });
      }

      // Por rt_ad: filtra Meta pelo regex e soma
      for (const { rtAd, regex } of rtAdRegexes) {
        let totalSpend = 0, totalRevenue = 0, totalConversions = 0;
        for (const mc of metaEnriched) {
          if (!regex.test(mc.campaign_name)) continue;
          totalSpend       += mc.cost;
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
