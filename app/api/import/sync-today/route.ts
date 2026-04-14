import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { fetchMetaMetricsPerDay } from '@/lib/meta';
import { fetchPaginatedRedTrack } from '@/lib/redtrack';
import { getRedtrackApiKey } from '@/lib/config';
import { format } from 'date-fns';

/**
 * POST /api/import/sync-today
 *
 * Sincroniza via API apenas os dados do dia atual para a conta Meta e campanha
 * RedTrack selecionadas na tela de import. Deve ser chamado quando o usuário
 * quer ver os números mais recentes do dia em andamento.
 *
 * Body: { accountId: string, rtCampaignId: string }
 *
 * Fluxo:
 *  1. Meta → fetchMetaMetricsPerDay para hoje → upsert em meta_ads_metrics
 *  2. RT rt_ad → fetchPaginatedRedTrack para hoje → upsert em import_cache
 *  3. RT rt_camp → fetchPaginatedRedTrack para hoje → upsert em import_cache
 */
export async function POST(req: NextRequest) {
  try {
    const { accountId, rtCampaignId } = await req.json();

    if (!accountId || !rtCampaignId) {
      return NextResponse.json({ error: 'accountId e rtCampaignId são obrigatórios.' }, { status: 400 });
    }

    const apiKey = await getRedtrackApiKey();
    if (!apiKey) {
      return NextResponse.json({ error: 'REDTRACK_API_KEY não configurada.' }, { status: 500 });
    }

    const today = format(new Date(), 'yyyy-MM-dd');

    // Busca o access_token da conta Meta no banco
    const accountResult = await pool.query(
      `SELECT access_token FROM meta_ad_accounts WHERE account_id = $1 LIMIT 1`,
      [accountId]
    );
    if (accountResult.rows.length === 0) {
      return NextResponse.json({ error: `Conta ${accountId} não encontrada no banco.` }, { status: 404 });
    }
    const accessToken: string = accountResult.rows[0].access_token;

    console.log(`[SyncToday] Conta Meta: ${accountId} | Campanha RT: ${rtCampaignId} | Data: ${today}`);

    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

    // 1. Meta: busca dados de hoje via API e upserta em meta_ads_metrics
    const metaRows = await fetchMetaMetricsPerDay(accountId, today, today, accessToken);
    console.log(`[SyncToday] Meta: ${metaRows.length} campanhas`);

    if (metaRows.length > 0) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const row of metaRows) {
          await client.query(
            `INSERT INTO meta_ads_metrics
               (date, account_id, campaign_id, campaign_name,
                spend, impressions, clicks, conversions, ctr, cpm)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (date, campaign_id) DO UPDATE SET
               account_id    = EXCLUDED.account_id,
               campaign_name = EXCLUDED.campaign_name,
               spend         = EXCLUDED.spend,
               impressions   = EXCLUDED.impressions,
               clicks        = EXCLUDED.clicks,
               conversions   = EXCLUDED.conversions,
               ctr           = EXCLUDED.ctr,
               cpm           = EXCLUDED.cpm`,
            [
              row.date, row.account_id, row.campaign_id, row.campaign_name,
              row.spend, row.impressions, row.clicks, row.conversions, row.ctr, row.cpm,
            ]
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    // 2. RT rt_ad: busca hoje via API
    await delay(1000);
    const rtAds = await fetchPaginatedRedTrack(
      `https://api.redtrack.io/report?api_key=${apiKey}` +
      `&date_from=${today}&date_to=${today}` +
      `&tz=America/Sao_Paulo&group=rt_ad&campaign_id=${rtCampaignId}`
    );
    console.log(`[SyncToday] RT rt_ad: ${rtAds.length} registros`);

    // 3. RT rt_campaign: busca hoje via API
    await delay(1000);
    const rtCampaigns = await fetchPaginatedRedTrack(
      `https://api.redtrack.io/report?api_key=${apiKey}` +
      `&date_from=${today}&date_to=${today}` +
      `&tz=America/Sao_Paulo&group=rt_campaign&campaign_id=${rtCampaignId}`
    );
    console.log(`[SyncToday] RT rt_camp: ${rtCampaigns.length} registros`);

    // 4. Upserta RT no import_cache
    await pool.query(
      `INSERT INTO import_cache (cache_key, date_from, date_to, data, synced_at)
       VALUES ($1, $2, $3, $4, NOW()), ($5, $2, $3, $6, NOW())
       ON CONFLICT (cache_key, date_from, date_to) DO UPDATE SET
         data = EXCLUDED.data, synced_at = NOW()`,
      [
        `rt_ad:${rtCampaignId}`,   today, today, JSON.stringify(rtAds),
        `rt_camp:${rtCampaignId}`,                JSON.stringify(rtCampaigns),
      ]
    );

    return NextResponse.json({
      success: true,
      meta_rows: metaRows.length,
      rt_ads: rtAds.length,
      rt_campaigns: rtCampaigns.length,
      date: today,
    });

  } catch (error: any) {
    console.error('[SyncToday Error]', error);
    return NextResponse.json(
      { error: error.message || 'Erro ao sincronizar dados de hoje.' },
      { status: 500 }
    );
  }
}
