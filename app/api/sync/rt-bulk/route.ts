import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { fetchPaginatedRedTrack } from '@/lib/redtrack';
import { getRedtrackApiKey } from '@/lib/config';
import { format, subDays } from 'date-fns';

/**
 * POST /api/sync/rt-bulk
 *
 * Sincroniza dados diários de rt_ad e rt_campaign para cada campanha
 * selecionada em redtrack_campaign_selections.
 *
 * Estratégia: uma entrada por dia no import_cache (date_from = date_to = dia).
 * Dias históricos já cacheados são pulados — só re-busca o dia de hoje
 * (que ainda está em andamento). O import/history combinam as entradas
 * diárias em runtime para qualquer período.
 *
 * Retorna NDJSON em streaming para mostrar progresso na UI.
 */
export async function POST() {
  const apiKey = await getRedtrackApiKey();
  if (!apiKey) {
    return NextResponse.json({ error: 'REDTRACK_API_KEY não configurada.' }, { status: 500 });
  }

  const DAYS_TO_SYNC = 30;
  const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
  const today = format(new Date(), 'yyyy-MM-dd');
  const oldestDay = format(subDays(new Date(), DAYS_TO_SYNC - 1), 'yyyy-MM-dd');

  let selectedCampaigns: { campaign_id: string; campaign_name: string }[] = [];
  try {
    const res = await pool.query(
      `SELECT campaign_id, campaign_name
       FROM redtrack_campaign_selections
       WHERE is_selected = true
       ORDER BY campaign_name ASC`
    );
    selectedCampaigns = res.rows;
  } catch (err: any) {
    return NextResponse.json({ error: 'Erro ao buscar campanhas: ' + err.message }, { status: 500 });
  }

  if (selectedCampaigns.length === 0) {
    return NextResponse.json(
      { error: 'Nenhuma campanha selecionada. Selecione campanhas em Configurações → Campanhas RedTrack.' },
      { status: 400 }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')); } catch {}
      };

      send({
        type: 'start',
        total: selectedCampaigns.length,
        daysToSync: DAYS_TO_SYNC,
        oldestDay,
        today,
      });

      let synced = 0;
      let errorCount = 0;

      for (let i = 0; i < selectedCampaigns.length; i++) {
        const camp = selectedCampaigns[i];
        send({ type: 'progress', index: i + 1, total: selectedCampaigns.length, campaign: camp.campaign_name });

        try {
          // Descobre quais dias já estão cacheados (exceto hoje, que sempre rebusca)
          const cachedResult = await pool.query(
            `SELECT DISTINCT date_from FROM import_cache
             WHERE cache_key = $1
               AND date_from >= $2
               AND date_from = date_to`,
            [`rt_ad:${camp.campaign_id}`, oldestDay]
          );
          const cachedDays = new Set(cachedResult.rows.map((r: any) => r.date_from));

          // Lista de dias a buscar: histórico ausente + sempre hoje
          const daysToFetch: string[] = [];
          for (let d = 0; d < DAYS_TO_SYNC; d++) {
            const day = format(subDays(new Date(), d), 'yyyy-MM-dd');
            if (day === today || !cachedDays.has(day)) {
              daysToFetch.push(day);
            }
          }

          console.log(`[RT-Bulk] ${camp.campaign_name}: ${daysToFetch.length} dias a buscar (${DAYS_TO_SYNC - daysToFetch.length} já em cache)`);

          let daysFetched = 0;
          for (const day of daysToFetch) {
            const rtAds = await fetchPaginatedRedTrack(
              `https://api.redtrack.io/report?api_key=${apiKey}` +
              `&date_from=${day}&date_to=${day}` +
              `&tz=America/Sao_Paulo&group=rt_ad&campaign_id=${camp.campaign_id}`
            );
            await delay(1000);

            const rtCampaigns = await fetchPaginatedRedTrack(
              `https://api.redtrack.io/report?api_key=${apiKey}` +
              `&date_from=${day}&date_to=${day}` +
              `&tz=America/Sao_Paulo&group=rt_campaign&campaign_id=${camp.campaign_id}`
            );
            await delay(1000);

            await pool.query(
              `INSERT INTO import_cache (cache_key, date_from, date_to, data, synced_at)
               VALUES ($1, $2, $2, $3, NOW()), ($4, $2, $2, $5, NOW())
               ON CONFLICT (cache_key, date_from, date_to) DO UPDATE SET
                 data = EXCLUDED.data, synced_at = NOW()`,
              [
                `rt_ad:${camp.campaign_id}`,  day, JSON.stringify(rtAds),
                `rt_camp:${camp.campaign_id}`,     JSON.stringify(rtCampaigns),
              ]
            );
            daysFetched++;
          }

          // Conta rt_ads distintos nos últimos 30 dias para o log
          const summaryResult = await pool.query(
            `SELECT data FROM import_cache
             WHERE cache_key = $1 AND date_from >= $2 AND date_from = date_to`,
            [`rt_ad:${camp.campaign_id}`, oldestDay]
          );
          const distinctRtAds = new Set(
            summaryResult.rows.flatMap((r: any) =>
              (r.data || []).map((e: any) => e.rt_ad).filter(Boolean)
            )
          ).size;

          synced++;
          send({
            type: 'campaign_done',
            campaign: camp.campaign_name,
            daysFetched,
            daysSkipped: DAYS_TO_SYNC - daysToFetch.length,
            rtAds: distinctRtAds,
            status: 'ok',
          });
        } catch (err: any) {
          errorCount++;
          send({ type: 'campaign_done', campaign: camp.campaign_name, status: 'error', error: err.message });
        }
      }

      send({ type: 'done', synced, errorCount, today, oldestDay });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
}
