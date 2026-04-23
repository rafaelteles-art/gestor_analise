import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getRedtrackApiKey } from '@/lib/config';
import { format, subDays, parseISO, isValid, differenceInCalendarDays } from 'date-fns';

export const maxDuration = 300;

/**
 * POST /api/sync/rt-bulk
 *
 * Sincroniza rt_ad, rt_campaign e sub3 no cache.
 *
 * Body:
 *   { mode: 'today' }
 *   { mode: 'yesterday' }
 *   { mode: 'days', days: 3 | 7 | ... }   → últimos N dias, incluindo hoje
 *   { mode: 'range', dateFrom: 'YYYY-MM-DD', dateTo: 'YYYY-MM-DD' }
 *
 * Todos os dias selecionados são re-buscados e sobrescritos no cache.
 * Retorna NDJSON em streaming com eventos de progresso.
 */
export async function POST(request: NextRequest) {
  const apiKey = await getRedtrackApiKey();
  if (!apiKey) {
    return NextResponse.json({ error: 'REDTRACK_API_KEY não configurada.' }, { status: 500 });
  }

  // ── Parse body e monta lista de dias ──────────────────────────────────
  const body = await request.json().catch(() => ({} as any));
  const mode: string = body.mode ?? 'today';
  const todayStr = format(new Date(), 'yyyy-MM-dd');

  let days: string[] = [];
  let rangeLabel = '';

  try {
    if (mode === 'today') {
      days = [todayStr];
      rangeLabel = todayStr;
    } else if (mode === 'yesterday') {
      const y = format(subDays(new Date(), 1), 'yyyy-MM-dd');
      days = [y];
      rangeLabel = y;
    } else if (mode === 'days') {
      const n = Math.min(Math.max(parseInt(body.days ?? '3', 10), 1), 90);
      days = Array.from({ length: n }, (_, i) => format(subDays(new Date(), i), 'yyyy-MM-dd')).reverse();
      rangeLabel = `${days[0]} → ${days[days.length - 1]} (${n}d)`;
    } else if (mode === 'range') {
      const from = parseISO(String(body.dateFrom ?? ''));
      const to   = parseISO(String(body.dateTo   ?? ''));
      if (!isValid(from) || !isValid(to)) {
        return NextResponse.json({ error: 'dateFrom/dateTo inválidos (use YYYY-MM-DD).' }, { status: 400 });
      }
      if (from > to) {
        return NextResponse.json({ error: 'dateFrom deve ser ≤ dateTo.' }, { status: 400 });
      }
      const span = differenceInCalendarDays(to, from);
      if (span > 90) {
        return NextResponse.json({ error: 'Intervalo máximo: 90 dias.' }, { status: 400 });
      }
      days = Array.from({ length: span + 1 }, (_, i) => format(subDays(to, span - i), 'yyyy-MM-dd'));
      rangeLabel = `${days[0]} → ${days[days.length - 1]} (${days.length}d)`;
    } else {
      return NextResponse.json({ error: `mode inválido: ${mode}` }, { status: 400 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: 'Erro ao processar datas: ' + err.message }, { status: 400 });
  }

  const DELAY_BETWEEN_CALLS_MS     = 3000;
  const DELAY_BETWEEN_CAMPAIGNS_MS = 2000;
  const RETRY_WAIT_MS              = 60000;
  const MAX_RETRIES                = 5;

  const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

  // ── Campanhas selecionadas ────────────────────────────────────────────
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

  // ── Streaming NDJSON ──────────────────────────────────────────────────
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')); } catch {}
      };
      const log = (message: string, level: 'info' | 'warn' | 'error' = 'info') =>
        send({ type: 'log', level, message, ts: Date.now() });

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

      // Todos os pares (campanha, dia) são buscados — sem pular cache.
      const tasks: { camp: typeof selectedCampaigns[number]; day: string }[] = [];
      for (const camp of selectedCampaigns) {
        for (const day of days) {
          tasks.push({ camp, day });
        }
      }
      const totalTasks = tasks.length;

      send({
        type: 'start',
        total: selectedCampaigns.length,
        totalTasks,
        days: days.length,
        today: todayStr,
        dateFrom: days[0],
        dateTo: days[days.length - 1],
        mode,
      });
      log(`Sincronização iniciada · ${selectedCampaigns.length} campanha(s) · ${rangeLabel}`);

      let synced = 0;
      let errorCount = 0;
      let taskIdx = 0;

      // Agrupa por campanha para manter o log amigável
      const byCamp = new Map<string, string[]>();
      for (const t of tasks) {
        const list = byCamp.get(t.camp.campaign_id) ?? [];
        list.push(t.day);
        byCamp.set(t.camp.campaign_id, list);
      }

      for (let i = 0; i < selectedCampaigns.length; i++) {
        const camp = selectedCampaigns[i];
        const campDays = byCamp.get(camp.campaign_id) ?? [];
        const idx = i + 1;

        if (campDays.length === 0) {
          log(`[${idx}/${selectedCampaigns.length}] ${camp.campaign_name} — todos os dias em cache, pulando`);
          continue;
        }

        log(`[${idx}/${selectedCampaigns.length}] ${camp.campaign_name} — ${campDays.length} dia(s) a buscar`);

        let campOk = 0, campErr = 0;
        let totalAds = 0, totalCamps = 0, totalCampIds = 0;

        for (const day of campDays) {
          taskIdx++;
          send({
            type: 'progress',
            index: taskIdx,
            total: totalTasks,
            campaign: camp.campaign_name,
            day,
            campaignIndex: idx,
            campaignTotal: selectedCampaigns.length,
          });

          try {
            log(`  ${day} → rt_ad`);
            const rtAds = await fetchWithRetry(
              `https://api.redtrack.io/report?api_key=${apiKey}` +
              `&date_from=${day}&date_to=${day}` +
              `&tz=America/Sao_Paulo&group=rt_ad&campaign_id=${camp.campaign_id}`,
              'rt_ad'
            );
            await delay(DELAY_BETWEEN_CALLS_MS);

            log(`  ${day} → rt_campaign`);
            const rtCampaigns = await fetchWithRetry(
              `https://api.redtrack.io/report?api_key=${apiKey}` +
              `&date_from=${day}&date_to=${day}` +
              `&tz=America/Sao_Paulo&group=rt_campaign&campaign_id=${camp.campaign_id}`,
              'rt_campaign'
            );
            await delay(DELAY_BETWEEN_CALLS_MS);

            log(`  ${day} → sub3`);
            const rtCampById = await fetchWithRetry(
              `https://api.redtrack.io/report?api_key=${apiKey}` +
              `&date_from=${day}&date_to=${day}` +
              `&tz=America/Sao_Paulo&group=sub3&campaign_id=${camp.campaign_id}`,
              'sub3'
            );

            await pool.query(
              `INSERT INTO import_cache (cache_key, date_from, date_to, data, synced_at)
               VALUES ($1, $2, $2, $3, NOW()), ($4, $2, $2, $5, NOW()), ($6, $2, $2, $7, NOW())
               ON CONFLICT (cache_key, date_from, date_to) DO UPDATE SET
                 data = EXCLUDED.data, synced_at = NOW()`,
              [
                `rt_ad:${camp.campaign_id}`,      day, JSON.stringify(rtAds),
                `rt_camp:${camp.campaign_id}`,         JSON.stringify(rtCampaigns),
                `rt_camp_id:${camp.campaign_id}`,      JSON.stringify(rtCampById),
              ]
            );
            log(`  ✓ ${day}: ${rtAds.length} rt_ads · ${rtCampaigns.length} rt_campaigns · ${rtCampById.length} sub3`);

            campOk++;
            totalAds += rtAds.length;
            totalCamps += rtCampaigns.length;
            totalCampIds += rtCampById.length;
            synced++;

            await delay(DELAY_BETWEEN_CALLS_MS);
          } catch (err: any) {
            campErr++;
            errorCount++;
            log(`  ✗ ${day}: ${err.message}`, 'error');
          }
        }

        send({
          type: 'campaign_done',
          campaign: camp.campaign_name,
          daysFetched: campOk,
          daysError: campErr,
          rtAds: totalAds,
          rtCampaigns: totalCamps,
          rtCampIds: totalCampIds,
          status: campErr === 0 ? 'ok' : (campOk === 0 ? 'error' : 'partial'),
        });

        if (idx < selectedCampaigns.length) {
          await delay(DELAY_BETWEEN_CAMPAIGNS_MS);
        }
      }

      log(`Concluído · ${synced} dia(s) salvo(s) · ${errorCount} erro(s)`, errorCount > 0 ? 'warn' : 'info');
      send({
        type: 'done',
        synced,
        errorCount,
        today: todayStr,
        dateFrom: days[0],
        dateTo: days[days.length - 1],
        daysCount: days.length,
      });
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
