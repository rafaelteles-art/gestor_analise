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

    const nameSet = new Set((metaCampaignNames || []) as string[]);

    // Processa ranges sequencialmente para evitar rate limiting nas APIs
    const results = [];
    for (const range of ranges) {
      const dFrom = format(subDays(today, range.days), 'yyyy-MM-dd');
      const dTo = format(today, 'yyyy-MM-dd');

      // 1. Meta + RedTrack em paralelo (dentro do mesmo range é seguro)
      const [fbRaw, rtData] = await Promise.all([
        fetchMetaMetrics(metaAccountId, dFrom, dTo),
        fetchPaginatedRedTrack(
          `https://api.redtrack.io/report?api_key=${apiKey}&date_from=${dFrom}&date_to=${dTo}&tz=America/Sao_Paulo&group=rt_campaign&campaign_id=${rtCampaignId}`
        )
      ]);

      // Meta spend: filtra pelos nomes exatos das campanhas do import
      let fbSpend = 0;
      if (nameSet.size > 0) {
        fbSpend = fbRaw
          .filter(row => nameSet.has(row.campaign_name))
          .reduce((acc, row) => acc + row.spend, 0) * usdToBrl;
      }

      // RedTrack receita: cruza por nome de campanha (igual ao dashboard principal)
      const rtCampByName = new Map<string, any>();
      (Array.isArray(rtData) ? rtData : []).forEach((rc: any) => {
        if (rc.rt_campaign) rtCampByName.set(rc.rt_campaign, rc);
      });

      let rtRevenue = 0;
      let rtConversions = 0;
      nameSet.forEach((campName) => {
        const rtCamp = rtCampByName.get(campName);
        if (rtCamp) {
          rtRevenue += parseFloat(rtCamp.total_revenue || '0');
          rtConversions += parseInt(rtCamp.convtype2 || '0', 10);
        }
      });

      results.push({
        label: range.label,
        metrics: {
          cost: fbSpend,
          revenue: rtRevenue,
          profit: rtRevenue - fbSpend,
          roas: fbSpend > 0 ? rtRevenue / fbSpend : 0,
          sales: rtConversions,
          cpa: rtConversions > 0 ? fbSpend / rtConversions : 0,
        }
      });
    }
    const finalData: any = {};
    results.forEach(r => { finalData[r.label] = r.metrics; });

    return NextResponse.json({ data: finalData });
  } catch (error: any) {
    console.error('[HoverAPI Error]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
