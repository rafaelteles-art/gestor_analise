import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { fetchPaginatedRedTrack } from '@/lib/redtrack';
import { getRedtrackApiKey } from '@/lib/config';
import { format, subDays } from 'date-fns';

/**
 * POST /api/sync/rt-bulk
 *
 * Sincroniza os dados de rt_ad e rt_campaign para cada campanha com
 * is_selected = true em redtrack_campaign_selections.
 * A filtragem é manual (feita pelo usuário nas configurações).
 *
 * Pré-popula 5 ranges no import_cache: hoje, ontem, 7d, 14d, 30d.
 * Retorna NDJSON em streaming para mostrar progresso na UI.
 */
export async function POST() {
  const apiKey = await getRedtrackApiKey();
  if (!apiKey) {
    return NextResponse.json({ error: 'REDTRACK_API_KEY não configurada.' }, { status: 500 });
  }

  const today      = format(new Date(), 'yyyy-MM-dd');
  const yesterday  = format(subDays(new Date(), 1),  'yyyy-MM-dd');
  const dateFrom7  = format(subDays(new Date(), 6),  'yyyy-MM-dd');
  const dateFrom14 = format(subDays(new Date(), 13), 'yyyy-MM-dd');
  const dateFrom30 = format(subDays(new Date(), 29), 'yyyy-MM-dd');

  const RANGES = [
    { dateFrom: today,      dateTo: today,     label: 'hoje'  },
    { dateFrom: yesterday,  dateTo: yesterday, label: 'ontem' },
    { dateFrom: dateFrom7,  dateTo: today,     label: '7d'    },
    { dateFrom: dateFrom14, dateTo: today,     label: '14d'   },
    { dateFrom: dateFrom30, dateTo: today,     label: '30d'   },
  ];

  // Somente campanhas marcadas manualmente pelo usuário
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

  // ── Streaming NDJSON ───────────────────────────────────────────────────────
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));

      send({
        type: 'start',
        step: 'sync',
        total: selectedCampaigns.length,
        ranges: RANGES.map(r => r.label),
        dateFrom: dateFrom30,
        dateTo: today,
      });

      let synced = 0;
      let errorCount = 0;

      for (let i = 0; i < selectedCampaigns.length; i++) {
        const camp = selectedCampaigns[i];
        send({ type: 'progress', index: i + 1, total: selectedCampaigns.length, campaign: camp.campaign_name });

        try {
          // Busca os ranges sequencialmente para respeitar rate limit de 2 req/s
          const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
          const rangeResults: { dateFrom: string; dateTo: string; rtAds: any[]; rtCampaigns: any[] }[] = [];
          for (const { dateFrom, dateTo } of RANGES) {
            const rtAds = await fetchPaginatedRedTrack(
              `https://api.redtrack.io/report?api_key=${apiKey}` +
              `&date_from=${dateFrom}&date_to=${dateTo}` +
              `&tz=America/Sao_Paulo&group=rt_ad&campaign_id=${camp.campaign_id}`
            );
            await delay(600);
            const rtCampaigns = await fetchPaginatedRedTrack(
              `https://api.redtrack.io/report?api_key=${apiKey}` +
              `&date_from=${dateFrom}&date_to=${dateTo}` +
              `&tz=America/Sao_Paulo&group=rt_campaign&campaign_id=${camp.campaign_id}`
            );
            await delay(600);
            rangeResults.push({ dateFrom, dateTo, rtAds, rtCampaigns });
          }

          // Upsert no import_cache para cada range
          for (const { dateFrom, dateTo, rtAds, rtCampaigns } of rangeResults) {
            await pool.query(
              `INSERT INTO import_cache (cache_key, date_from, date_to, data, synced_at)
               VALUES ($1, $2, $3, $4, NOW()), ($5, $2, $3, $6, NOW())
               ON CONFLICT (cache_key, date_from, date_to) DO UPDATE SET
                 data = EXCLUDED.data, synced_at = NOW()`,
              [
                `rt_ad:${camp.campaign_id}`,   dateFrom, dateTo, JSON.stringify(rtAds),
                `rt_camp:${camp.campaign_id}`,                   JSON.stringify(rtCampaigns),
              ]
            );
          }

          // Exibe totais do range de 30d no log
          const r30 = rangeResults.find(r => r.dateFrom === dateFrom30)!;
          synced++;
          send({
            type: 'campaign_done',
            campaign: camp.campaign_name,
            rtAds: r30.rtAds.length,
            rtCampaigns: r30.rtCampaigns.length,
            status: 'ok',
          });
        } catch (err: any) {
          errorCount++;
          send({ type: 'campaign_done', campaign: camp.campaign_name, status: 'error', error: err.message });
        }
      }

      send({ type: 'done', synced, errorCount, skipped: 0, dateFrom: dateFrom30, dateTo: today });
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
