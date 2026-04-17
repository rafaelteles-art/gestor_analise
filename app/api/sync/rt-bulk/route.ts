import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getRedtrackApiKey } from '@/lib/config';
import { format, subDays } from 'date-fns';

/**
 * POST /api/sync/rt-bulk
 *
 * Sincroniza rt_ad e rt_campaign de um único dia (hoje ou ontem), uma campanha
 * por vez, com delay entre chamadas e retry em caso de 429.
 *
 * Body: { mode: 'today' | 'yesterday' }
 *
 * Retorna NDJSON em streaming com eventos `log` para mostrar o que está
 * acontecendo em tempo real na UI.
 */
export async function POST(request: NextRequest) {
  const apiKey = await getRedtrackApiKey();
  if (!apiKey) {
    return NextResponse.json({ error: 'REDTRACK_API_KEY não configurada.' }, { status: 500 });
  }

  let mode: 'today' | 'yesterday' = 'today';
  try {
    const body = await request.json();
    if (body.mode === 'yesterday') mode = 'yesterday';
  } catch {}

  const DELAY_BETWEEN_CALLS_MS    = 3000;  // 3s entre chamadas à API RedTrack
  const DELAY_BETWEEN_CAMPAIGNS_MS = 2000; // 2s extra entre campanhas
  const RETRY_WAIT_MS              = 60000; // espera após 429 antes de tentar de novo
  const MAX_RETRIES                = 5;

  const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
  const targetDate = mode === 'yesterday'
    ? format(subDays(new Date(), 1), 'yyyy-MM-dd')
    : format(new Date(), 'yyyy-MM-dd');

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
      const log = (message: string, level: 'info' | 'warn' | 'error' = 'info') =>
        send({ type: 'log', level, message, ts: Date.now() });

      // Busca paginada com retry em 429. Devolve todas as linhas ou lança erro.
      const fetchWithRetry = async (url: string, tag: string): Promise<any[]> => {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          const allData: any[] = [];
          let page = 1;
          let rateLimited = false;

          while (true) {
            const pagedUrl = `${url}&per=1000&page=${page}`;
            const res = await fetch(pagedUrl, { headers: { Accept: 'application/json' } });

            if (res.status === 429) {
              log(`429 em ${tag} — aguardando ${RETRY_WAIT_MS / 1000}s (tentativa ${attempt}/${MAX_RETRIES})`, 'warn');
              await delay(RETRY_WAIT_MS);
              rateLimited = true;
              break;
            }
            if (!res.ok) {
              const body = await res.text().catch(() => '');
              throw new Error(`HTTP ${res.status} em ${tag}: ${body.slice(0, 120)}`);
            }

            const data = await res.json();
            const arr = Array.isArray(data) ? data : (data?.data || []);
            if (arr.length === 0) break;
            allData.push(...arr);
            if (arr.length < 1000) break;
            page++;
          }

          if (!rateLimited) return allData;
        }
        throw new Error(`Esgotou ${MAX_RETRIES} tentativas por rate limit em ${tag}`);
      };

      send({ type: 'start', total: selectedCampaigns.length, today: targetDate });
      log(`Sincronização iniciada · ${selectedCampaigns.length} campanha(s) · dia ${targetDate}`);

      let synced = 0;
      let errorCount = 0;

      for (let i = 0; i < selectedCampaigns.length; i++) {
        const camp = selectedCampaigns[i];
        const idx = i + 1;
        send({ type: 'progress', index: idx, total: selectedCampaigns.length, campaign: camp.campaign_name });
        log(`[${idx}/${selectedCampaigns.length}] ${camp.campaign_name}`);

        try {
          log(`  → buscando rt_ad (${targetDate})`);
          const rtAds = await fetchWithRetry(
            `https://api.redtrack.io/report?api_key=${apiKey}` +
            `&date_from=${targetDate}&date_to=${targetDate}` +
            `&tz=America/Sao_Paulo&group=rt_ad&campaign_id=${camp.campaign_id}`,
            'rt_ad'
          );
          log(`  ✓ rt_ad: ${rtAds.length} registros`);
          await delay(DELAY_BETWEEN_CALLS_MS);

          log(`  → buscando rt_campaign (${targetDate})`);
          const rtCampaigns = await fetchWithRetry(
            `https://api.redtrack.io/report?api_key=${apiKey}` +
            `&date_from=${targetDate}&date_to=${targetDate}` +
            `&tz=America/Sao_Paulo&group=rt_campaign&campaign_id=${camp.campaign_id}`,
            'rt_campaign'
          );
          log(`  ✓ rt_campaign: ${rtCampaigns.length} registros`);
          await delay(DELAY_BETWEEN_CALLS_MS);

          log(`  → buscando sub3 (meta_campaign_id) (${targetDate})`);
          const rtCampById = await fetchWithRetry(
            `https://api.redtrack.io/report?api_key=${apiKey}` +
            `&date_from=${targetDate}&date_to=${targetDate}` +
            `&tz=America/Sao_Paulo&group=sub3&campaign_id=${camp.campaign_id}`,
            'sub3'
          );
          log(`  ✓ sub3: ${rtCampById.length} registros`);

          // Upsert do dia alvo — dias anteriores nunca são tocados.
          await pool.query(
            `INSERT INTO import_cache (cache_key, date_from, date_to, data, synced_at)
             VALUES ($1, $2, $2, $3, NOW()), ($4, $2, $2, $5, NOW()), ($6, $2, $2, $7, NOW())
             ON CONFLICT (cache_key, date_from, date_to) DO UPDATE SET
               data = EXCLUDED.data, synced_at = NOW()`,
            [
              `rt_ad:${camp.campaign_id}`,      targetDate, JSON.stringify(rtAds),
              `rt_camp:${camp.campaign_id}`,                JSON.stringify(rtCampaigns),
              `rt_camp_id:${camp.campaign_id}`,             JSON.stringify(rtCampById),
            ]
          );
          log(`  ✓ cache atualizado`);

          synced++;
          send({
            type: 'campaign_done',
            campaign: camp.campaign_name,
            daysFetched: 1,
            rtAds: rtAds.length,
            rtCampaigns: rtCampaigns.length,
            rtCampIds: rtCampById.length,
            status: 'ok',
          });
        } catch (err: any) {
          errorCount++;
          log(`  ✗ erro: ${err.message}`, 'error');
          send({ type: 'campaign_done', campaign: camp.campaign_name, status: 'error', error: err.message });
        }

        // Pausa entre campanhas (exceto após a última) para aliviar a API
        if (idx < selectedCampaigns.length) {
          await delay(DELAY_BETWEEN_CAMPAIGNS_MS);
        }
      }

      log(`Concluído · ${synced} ok · ${errorCount} erro(s)`, errorCount > 0 ? 'warn' : 'info');
      send({ type: 'done', synced, errorCount, today: targetDate });
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
