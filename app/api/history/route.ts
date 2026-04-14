import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { format, subDays } from 'date-fns';

// ============================================================
// USD→BRL — PTAX do Banco Central (mesma lógica do /api/import)
// ============================================================
async function getUsdToBrl(): Promise<number> {
  const today = new Date();
  for (let i = 0; i < 5; i++) {
    const d = subDays(today, i);
    const mm   = String(d.getMonth() + 1).padStart(2, '0');
    const dd   = String(d.getDate()).padStart(2, '0');
    const yyyy = d.getFullYear();
    const dateStr = `${mm}-${dd}-${yyyy}`;
    try {
      const res = await fetch(
        `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarDia(dataCotacao=@dataCotacao)?@dataCotacao='${dateStr}'&$top=1&$format=json&$select=cotacaoVenda`,
        { cache: 'no-store', signal: AbortSignal.timeout(5000) }
      );
      const data = await res.json();
      if (Array.isArray(data?.value) && data.value.length > 0) {
        return parseFloat(data.value[0].cotacaoVenda);
      }
    } catch { /* tenta o dia anterior */ }
  }
  console.warn('[History] Cotação PTAX indisponível, usando 5.50');
  return 5.50;
}

// ============================================================
// Extrai receita e vendas do blob JSON do import_cache,
// cruzando pelo nome da campanha (exato + parcial, igual ao /import).
// ============================================================
function extractRtMetrics(
  cacheData: any[],
  metaCampaignNames: string[]
): { revenue: number; conversions: number } {
  const rtCampByName = new Map<string, any>();
  for (const rc of cacheData) {
    if (rc.rt_campaign) rtCampByName.set(rc.rt_campaign, rc);
  }

  let revenue = 0;
  let conversions = 0;

  for (const metaName of metaCampaignNames) {
    const metaLower = metaName.toLowerCase();
    const matches: any[] = [];

    for (const [rtName, rtCamp] of rtCampByName) {
      const isExact   = rtName === metaName;
      const isPartial = rtName.length > 10 && metaLower.includes(rtName.toLowerCase());
      if (isExact || isPartial) matches.push(rtCamp);
    }

    for (const m of matches) {
      revenue     += parseFloat(m.total_revenue || '0');
      conversions += parseInt(m.convtype2       || '0', 10);
    }
  }

  return { revenue, conversions };
}

// ============================================================
// ROUTE HANDLER
// Lê exclusivamente do banco de dados.
// Meta spend vem de meta_ads_metrics; RT vem de import_cache.
// ============================================================
export async function POST(req: NextRequest) {
  try {
    const { metaAccountId, metaCampaignNames, rtCampaignId } = await req.json();

    if (!metaAccountId || !rtCampaignId) {
      return NextResponse.json({ error: 'Parâmetros insuficientes' }, { status: 400 });
    }

    const campaignNames: string[] = metaCampaignNames || [];
    const today     = format(new Date(), 'yyyy-MM-dd');
    const yesterday = format(subDays(new Date(), 1),  'yyyy-MM-dd');
    const d2ago     = format(subDays(new Date(), 2),  'yyyy-MM-dd');
    const d6ago     = format(subDays(new Date(), 6),  'yyyy-MM-dd');
    const d13ago    = format(subDays(new Date(), 13), 'yyyy-MM-dd');
    const d29ago    = format(subDays(new Date(), 29), 'yyyy-MM-dd');

    // Ranges que o hover exibe (14D e 30D ficam como N/A no popup)
    const RANGES = [
      { label: 'Hoje',     dateFrom: today,     dateTo: today  },
      { label: '2D',       dateFrom: yesterday,  dateTo: today  },
      { label: '3D',       dateFrom: d2ago,      dateTo: today  },
      { label: '7D',       dateFrom: d6ago,      dateTo: today  },
      { label: '14D',      dateFrom: d13ago,     dateTo: today  },
      { label: '30D+HOJE', dateFrom: d29ago,     dateTo: today  },
    ];

    const usdToBrl = await getUsdToBrl();
    const rtCacheKey = `rt_camp:${rtCampaignId}`;

    // Busca todos os ranges do import_cache em paralelo
    const rtCacheResults = await Promise.all(
      RANGES.map(({ dateFrom, dateTo }) =>
        pool.query(
          `SELECT data FROM import_cache
           WHERE cache_key = $1 AND date_from = $2 AND date_to = $3
           ORDER BY synced_at DESC LIMIT 1`,
          [rtCacheKey, dateFrom, dateTo]
        )
      )
    );

    // Busca gasto Meta para cada range em paralelo (agrega de meta_ads_metrics)
    const metaResults = await Promise.all(
      RANGES.map(({ dateFrom, dateTo }) =>
        pool.query(
          `SELECT
             COALESCE(SUM(spend), 0)::float       AS spend,
             COALESCE(SUM(impressions), 0)::int   AS impressions,
             COALESCE(SUM(clicks), 0)::int        AS clicks
           FROM meta_ads_metrics
           WHERE account_id    = $1
             AND campaign_name = ANY($2)
             AND date >= $3
             AND date <= $4`,
          [metaAccountId, campaignNames, dateFrom, dateTo]
        )
      )
    );

    // Monta o resultado por label
    const finalData: Record<string, any> = {};

    for (let i = 0; i < RANGES.length; i++) {
      const { label } = RANGES[i];

      const metaRow   = metaResults[i].rows[0];
      const spendBrl  = parseFloat(metaRow.spend) * usdToBrl;

      const rtCacheRow = rtCacheResults[i].rows[0];
      const rtData: any[] = rtCacheRow ? rtCacheRow.data : [];
      const { revenue, conversions } = extractRtMetrics(rtData, campaignNames);

      finalData[label] = {
        cost:        spendBrl,
        revenue,
        profit:      revenue - spendBrl,
        roas:        spendBrl > 0 ? revenue / spendBrl : 0,
        sales:       conversions,
        cpa:         conversions > 0 ? spendBrl / conversions : 0,
        impressions: parseInt(metaRow.impressions),
        clicks:      parseInt(metaRow.clicks),
      };
    }

    return NextResponse.json({ data: finalData });

  } catch (error: any) {
    console.error('[History Error]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
