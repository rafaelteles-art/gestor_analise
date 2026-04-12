import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { fetchMetaMetrics } from '@/lib/meta';
import { fetchRedTrackMetrics } from '@/lib/redtrack';

export async function POST() {
  const client = await pool.connect();
  try {
    const today = new Date();
    today.setDate(today.getDate() - 1); // Yesterday
    const dateStr = today.toISOString().split('T')[0];

    console.log(`Buscando métricas da data: ${dateStr}`);

    // 1. Consulta QUAIS contas do Meta Ads o usuário habilitou para sincronizar
    const { rows: accounts } = await client.query(
      `SELECT account_id FROM public.meta_ad_accounts WHERE is_selected = true`
    );
    const selectedAccounts = accounts.map((a: any) => a.account_id);

    // 2. Extrair dados em paralelo
    const metaPromises = selectedAccounts.map((accId: string) => fetchMetaMetrics(accId, dateStr, dateStr));
    const [metaDataArrays, redtrackData] = await Promise.all([
      Promise.all(metaPromises),
      fetchRedTrackMetrics(dateStr, dateStr, [])
    ]);
    const metaData = metaDataArrays.flat();

    // 3. Upsert Meta Ads no GCP
    let metaCount = 0;
    if (metaData.length > 0) {
      for (const row of metaData) {
        await client.query(
          `INSERT INTO public.meta_ads_metrics (date, campaign_id, campaign_name, spend, impressions, clicks, conversions, ctr, cpm)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (date, campaign_id) DO UPDATE SET
             campaign_name = EXCLUDED.campaign_name,
             spend = EXCLUDED.spend,
             impressions = EXCLUDED.impressions,
             clicks = EXCLUDED.clicks,
             conversions = EXCLUDED.conversions,
             ctr = EXCLUDED.ctr,
             cpm = EXCLUDED.cpm`,
          [row.date, row.campaign_id, row.campaign_name, row.spend, row.impressions, row.clicks, row.conversions, row.ctr, row.cpm]
        );
        metaCount++;
      }
    }

    // 4. Upsert RedTrack no GCP
    let redtrackCount = 0;
    if (redtrackData.length > 0) {
      for (const row of redtrackData) {
        await client.query(
          `INSERT INTO public.redtrack_metrics (date, campaign_id, campaign_name, clicks, conversions, total_conversions, revenue, total_revenue, cost, profit, roas)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (date, campaign_id) DO UPDATE SET
             campaign_name = EXCLUDED.campaign_name,
             clicks = EXCLUDED.clicks,
             conversions = EXCLUDED.conversions,
             total_conversions = EXCLUDED.total_conversions,
             revenue = EXCLUDED.revenue,
             total_revenue = EXCLUDED.total_revenue,
             cost = EXCLUDED.cost,
             profit = EXCLUDED.profit,
             roas = EXCLUDED.roas`,
          [row.date, row.campaign_id, row.campaign_name, row.clicks, row.conversions, row.total_conversions, row.revenue, row.total_revenue, row.cost, row.profit, row.roas]
        );
        redtrackCount++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `Sincronização Finalizada. ${metaCount} campanhas do Meta e ${redtrackCount} do RedTrack salvas.`,
      records: { metaData, redtrackData }
    });

  } catch (error: any) {
    console.error("Critical Sync Error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
