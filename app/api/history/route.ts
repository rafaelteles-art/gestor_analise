import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { format, subDays } from 'date-fns';

// ============================================================
// USD→BRL — PTAX do Banco Central (cache em memória por dia)
// ============================================================
let ptaxCache: { value: number; date: string } | null = null;

async function getUsdToBrl(): Promise<number> {
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  if (ptaxCache?.date === todayStr) return ptaxCache.value;

  const today = new Date();
  for (let i = 0; i < 5; i++) {
    const d = subDays(today, i);
    const mm   = String(d.getMonth() + 1).padStart(2, '0');
    const dd   = String(d.getDate()).padStart(2, '0');
    const yyyy = d.getFullYear();
    try {
      const res = await fetch(
        `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarDia(dataCotacao=@dataCotacao)?@dataCotacao='${mm}-${dd}-${yyyy}'&$top=1&$format=json&$select=cotacaoVenda`,
        { cache: 'no-store', signal: AbortSignal.timeout(5000) }
      );
      const data = await res.json();
      if (Array.isArray(data?.value) && data.value.length > 0) {
        const value = parseFloat(data.value[0].cotacaoVenda);
        ptaxCache = { value, date: todayStr };
        return value;
      }
    } catch { /* tenta o dia anterior */ }
  }
  console.warn('[History] Cotação PTAX indisponível, usando 5.50');
  return 5.50;
}

// ============================================================
// COMBINADOR — soma total_revenue e convtype2 por campanha RT
// nas linhas diárias retornadas pelo import_cache.
// ============================================================
function combineDailyRtCamp(
  rows: { date_from: string; data: any[] }[],
  fromDate: string
): { rt_campaign: string; total_revenue: string; convtype2: string }[] {
  const map = new Map<string, { total_revenue: number; convtype2: number }>();
  for (const row of rows) {
    if (row.date_from < fromDate) continue; // filtra pelo range desejado
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

// ============================================================
// Extrai receita/vendas do blob combinado cruzando pelo nome
// da campanha Meta (exato + parcial, igual ao /import).
// ============================================================
function extractRtMetrics(
  rtCampData: { rt_campaign: string; total_revenue: string; convtype2: string }[],
  metaCampaignNames: string[]
): { revenue: number; conversions: number } {
  const rtCampByName = new Map(rtCampData.map(rc => [rc.rt_campaign, rc]));
  let revenue = 0;
  let conversions = 0;

  for (const metaName of metaCampaignNames) {
    const metaLower = metaName.toLowerCase();
    for (const [rtName, rc] of rtCampByName) {
      const isExact   = rtName === metaName;
      const isPartial = rtName.length > 10 && metaLower.includes(rtName.toLowerCase());
      if (isExact || isPartial) {
        revenue     += parseFloat(rc.total_revenue || '0');
        conversions += parseInt(rc.convtype2 || '0', 10);
      }
    }
  }
  return { revenue, conversions };
}

// ============================================================
// ROUTE HANDLER
// Uma única query para cada fonte (Meta e RT), depois filtra
// por range no código para evitar N queries paralelas.
// ============================================================
export async function POST(req: NextRequest) {
  try {
    const { metaAccountId, metaCampaignNames, rtCampaignId } = await req.json();

    if (!metaAccountId || !rtCampaignId) {
      return NextResponse.json({ error: 'Parâmetros insuficientes' }, { status: 400 });
    }

    const campaignNames: string[] = metaCampaignNames || [];
    const today  = format(new Date(), 'yyyy-MM-dd');
    const d29ago = format(subDays(new Date(), 29), 'yyyy-MM-dd');

    // Ranges exibidos no hover (14D e 30D ficam como N/A visualmente)
    const RANGES = [
      { label: 'Hoje',     dateFrom: today },
      { label: '2D',       dateFrom: format(subDays(new Date(), 1),  'yyyy-MM-dd') },
      { label: '3D',       dateFrom: format(subDays(new Date(), 2),  'yyyy-MM-dd') },
      { label: '7D',       dateFrom: format(subDays(new Date(), 6),  'yyyy-MM-dd') },
      { label: '14D',      dateFrom: format(subDays(new Date(), 13), 'yyyy-MM-dd') },
      { label: '30D+HOJE', dateFrom: d29ago },
    ];

    // Busca tudo de uma vez (últimos 30 dias), filtra por range no código
    const [rtRows, metaRows, usdToBrl] = await Promise.all([
      pool.query(
        `SELECT date_from, data FROM import_cache
         WHERE cache_key = $1
           AND date_from >= $2
           AND date_from = date_to
         ORDER BY date_from`,
        [`rt_camp:${rtCampaignId}`, d29ago]
      ),
      pool.query(
        `SELECT date, SUM(spend)::float AS spend, SUM(impressions)::int AS impressions, SUM(clicks)::int AS clicks
         FROM meta_ads_metrics
         WHERE account_id    = $1
           AND campaign_name = ANY($2)
           AND date >= $3 AND date <= $4
         GROUP BY date ORDER BY date`,
        [metaAccountId, campaignNames, d29ago, today]
      ),
      getUsdToBrl(),
    ]);

    const finalData: Record<string, any> = {};

    for (const { label, dateFrom } of RANGES) {
      // RT: combina entradas diárias a partir de dateFrom
      const rtData = combineDailyRtCamp(rtRows.rows, dateFrom);
      const { revenue, conversions } = extractRtMetrics(rtData, campaignNames);

      // Meta: soma dias a partir de dateFrom
      const metaFiltered = metaRows.rows.filter((r: any) => r.date >= dateFrom);
      const spendBrl = metaFiltered.reduce((s: number, r: any) => s + r.spend, 0) * usdToBrl;
      const impressions = metaFiltered.reduce((s: number, r: any) => s + r.impressions, 0);
      const clicks      = metaFiltered.reduce((s: number, r: any) => s + r.clicks, 0);

      finalData[label] = {
        cost:        spendBrl,
        revenue,
        profit:      revenue - spendBrl,
        roas:        spendBrl > 0 ? revenue / spendBrl : 0,
        sales:       conversions,
        cpa:         conversions > 0 ? spendBrl / conversions : 0,
        impressions,
        clicks,
      };
    }

    return NextResponse.json({ data: finalData });

  } catch (error: any) {
    console.error('[History Error]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
