import { NextRequest, NextResponse } from 'next/server';
import { format, subDays } from 'date-fns';
import { fetchMetaMetrics } from '@/lib/meta';
import { fetchPaginatedRedTrack } from '@/lib/redtrack';

// Reusa a cotação USD->BRL
async function getUsdToBrl(): Promise<number> {
  try {
    const res = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL');
    const data = await res.json();
    return parseFloat(data.USDBRL.bid);
  } catch (e) {
    return 5.50;
  }
}

// Para um dado nome de anúncio e as contas, fetch nas 5 janelas
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { rtAdName, metaAccountId, metaCampaignNames, rtCampaignId } = body;

    if (!rtAdName || !metaAccountId || !rtCampaignId) {
      return NextResponse.json({ error: 'Parâmetros insuficientes' }, { status: 400 });
    }

    const apiKey = process.env.REDTRACK_API_KEY;
    if (!apiKey) throw new Error('Sem API KEY RT');

    const today = new Date();
    const ranges = [
      { label: 'Hoje', days: 0 },
      { label: '2D', days: 1 },
      { label: '3D', days: 2 },
      { label: '7D', days: 6 },
      { label: '30D+HOJE', days: 29 },
    ];

    const usdToBrl = await getUsdToBrl();

    const rangePromises = ranges.map(async (range) => {
      const dFrom = format(subDays(today, range.days), 'yyyy-MM-dd');
      const dTo = format(today, 'yyyy-MM-dd');

      // 1. Meta
      const fbRaw = await fetchMetaMetrics(metaAccountId, dFrom, dTo);
      let fbSpend = 0;
      let fbCpa = 0;

      // Executa o regex exato para achar TODAS as variações de campanha no Meta deste período
      if (rtAdName) {
        const escapedAd = rtAdName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const exactMatchRegex = new RegExp(`(?:^|[^a-zA-Z0-9_.])` + escapedAd + `(?:[^a-zA-Z0-9_.]|$)`, 'i');
        
        const matchingFb = fbRaw.filter(fbRow => exactMatchRegex.test(fbRow.campaign_name));
        if (matchingFb.length > 0) {
            fbSpend = matchingFb.reduce((acc, curr) => acc + curr.spend, 0) * usdToBrl;
        }
      }

      // 2. RedTrack
      const url = `https://api.redtrack.io/report?api_key=${apiKey}&date_from=${dFrom}&date_to=${dTo}&tz=America/Sao_Paulo&group=rt_ad&campaign_id=${rtCampaignId}`;
      const rtData = await fetchPaginatedRedTrack(url);
      
      let rtRevenue = 0;
      let rtConversions = 0;
      const rtAdRow = (Array.isArray(rtData) ? rtData : []).find((r: any) => r.rt_ad === rtAdName);
      if (rtAdRow) {
          rtRevenue = parseFloat(rtAdRow.total_revenue || '0');
          rtConversions = parseInt(rtAdRow.convtype2 || '0', 10);
      }

      const profit = rtRevenue - fbSpend;
      const roas = fbSpend > 0 ? rtRevenue / fbSpend : 0;
      const cpa = rtConversions > 0 ? (fbSpend / rtConversions) : 0;

      return {
        label: range.label,
        metrics: {
          cost: fbSpend,
          revenue: rtRevenue,
          profit: profit,
          roas: roas,
          sales: rtConversions,
          cpa: cpa
        }
      };
    });

    const results = await Promise.all(rangePromises);
    const finalData: any = {};
    results.forEach(r => { finalData[r.label] = r.metrics; });

    return NextResponse.json({ data: finalData });
  } catch (error: any) {
    console.error('[HoverAPI Error]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
