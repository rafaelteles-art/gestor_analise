import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getUsdToBrl } from '@/lib/usd-brl';
import { aggregateMetaAdsByName } from '@/lib/creative-breakdown';

/**
 * POST /api/import/campaign-ads
 *
 * Lado Meta do Creative Breakdown (ADR-0011): insights level=ad AO VIVO para
 * os campaign_ids de uma linha do dashboard v2, agregados por ad_name
 * (= Creative Code — as N cópias do criativo somadas). Deliberadamente não é
 * sincronizado para o banco: seria ~10-40× o volume do sync Meta atual.
 *
 * Body: { accountId: string, campaignIds: string[], dateFrom, dateTo }
 * Retorna { ads: { [creative]: { spend, impressions, clicks, ctr, cpm } } }
 * (cpm já convertido para BRL, como as linhas de campanha do /api/import).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const accountId: string = typeof body.accountId === 'string' ? body.accountId : '';
    const campaignIds: string[] = Array.isArray(body.campaignIds)
      ? body.campaignIds.filter((x: any) => typeof x === 'string' && x.length > 0)
      : [];
    const dateFrom: string = typeof body.dateFrom === 'string' ? body.dateFrom : '';
    const dateTo: string = typeof body.dateTo === 'string' ? body.dateTo : '';

    if (!accountId || campaignIds.length === 0 || !dateFrom || !dateTo) {
      return NextResponse.json({ error: 'Parâmetros insuficientes' }, { status: 400 });
    }

    // Token da conta — mesmo caminho do sync-today.
    const accountResult = await pool.query(
      `SELECT access_token FROM meta_ad_accounts WHERE account_id = $1 LIMIT 1`,
      [accountId]
    );
    if (accountResult.rows.length === 0 || !accountResult.rows[0].access_token) {
      return NextResponse.json({ error: `Conta ${accountId} sem token no banco.` }, { status: 404 });
    }
    const token: string = accountResult.rows[0].access_token;

    const usdToBrl = await getUsdToBrl(dateTo);

    const fields = 'ad_name,spend,impressions,clicks';
    const allRows: { ad_name: string; spend: number; impressions: number; clicks: number }[] = [];

    for (const campaignId of campaignIds) {
      let url: string | null =
        `https://graph.facebook.com/v19.0/${campaignId}/insights` +
        `?fields=${fields}` +
        `&time_range={'since':'${dateFrom}','until':'${dateTo}'}` +
        `&level=ad&limit=500&access_token=${token}`;

      while (url) {
        const res: Response = await fetch(url);
        const data: any = await res.json();
        if (data.error) {
          const msg = data.error.message ?? JSON.stringify(data.error);
          throw new Error(`Meta ${campaignId}: ${msg}`);
        }
        for (const item of data.data ?? []) {
          allRows.push({
            ad_name: item.ad_name ?? '',
            spend: parseFloat(item.spend || '0'),
            impressions: parseInt(item.impressions || '0', 10),
            clicks: parseInt(item.clicks || '0', 10),
          });
        }
        url = data.paging?.next || null;
      }
    }

    const ads = Object.fromEntries(aggregateMetaAdsByName(allRows, usdToBrl));
    return NextResponse.json({ ads });
  } catch (error: any) {
    console.error('[CampaignAds Error]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
