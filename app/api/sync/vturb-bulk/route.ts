import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getVturbApiToken } from '@/lib/config';
import {
  fetchVturbPlayers,
  fetchVturbPlayerDaily,
  VturbDailyMetric,
} from '@/lib/vturb';
import { format, subDays } from 'date-fns';

export const maxDuration = 300;

const CONCURRENCY = 3; // players processados em paralelo

async function ensureVturbTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vturb_metrics (
      date DATE NOT NULL,
      player_id TEXT NOT NULL,
      player_name TEXT,
      total_started     BIGINT  DEFAULT 0,
      total_finished    BIGINT  DEFAULT 0,
      total_viewed      BIGINT  DEFAULT 0,
      total_clicked     BIGINT  DEFAULT 0,
      unique_devices    BIGINT  DEFAULT 0,
      unique_sessions   BIGINT  DEFAULT 0,
      engagement_rate   NUMERIC DEFAULT 0,
      play_rate         NUMERIC DEFAULT 0,
      conversion_rate   NUMERIC DEFAULT 0,
      conversions       BIGINT  DEFAULT 0,
      amount_brl        NUMERIC DEFAULT 0,
      amount_usd        NUMERIC DEFAULT 0,
      raw               JSONB,
      updated_at        TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (date, player_id)
    )
  `);
}

/**
 * POST /api/sync/vturb-bulk
 *
 * Busca dados diários de todos os players do vturb nos últimos N dias
 * (padrão: 30) e grava em vturb_metrics. Retorna progresso em streaming
 * NDJSON, no mesmo formato de /api/sync/meta-bulk.
 *
 * Body (opcional): { days?: number }  — 1..90, padrão 30
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const days: number = Math.min(Math.max(parseInt(body.days ?? '30', 10), 1), 90);

  const dateTo   = format(new Date(), 'yyyy-MM-dd');
  const dateFrom = format(subDays(new Date(), days - 1), 'yyyy-MM-dd');

  const token = await getVturbApiToken();
  if (!token) {
    return NextResponse.json(
      { error: 'VTURB_API_TOKEN não configurado. Defina em Configurações de Integração.' },
      { status: 400 },
    );
  }

  try {
    await ensureVturbTable();
  } catch (err: any) {
    return NextResponse.json({ error: 'Erro criando tabela vturb_metrics: ' + err.message }, { status: 500 });
  }

  // Busca a lista de players primeiro (fora do stream — se falhar, retorna 4xx limpo)
  let players: Awaited<ReturnType<typeof fetchVturbPlayers>> = [];
  try {
    players = await fetchVturbPlayers(token);
  } catch (err: any) {
    return NextResponse.json({ error: 'Erro listando players do vturb: ' + err.message }, { status: 502 });
  }

  if (players.length === 0) {
    return NextResponse.json({ error: 'Nenhum player encontrado na conta vturb.' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
        } catch {
          // cliente desconectou
        }
      };

      send({ type: 'start', total: players.length, dateFrom, dateTo, days });

      let totalRows = 0;
      let errorCount = 0;

      const processPlayer = async (player: typeof players[0]) => {
        const label = player.name || player.id;
        try {
          const rows: VturbDailyMetric[] = await fetchVturbPlayerDaily(
            token,
            player,
            dateFrom,
            dateTo,
          );

          if (rows.length === 0) {
            send({ type: 'account_done', account: label, rows: 0, status: 'empty' });
            return;
          }

          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            for (const r of rows) {
              await client.query(
                `INSERT INTO vturb_metrics
                   (date, player_id, player_name,
                    total_started, total_finished, total_viewed, total_clicked,
                    unique_devices, unique_sessions,
                    engagement_rate, play_rate, conversion_rate,
                    conversions, amount_brl, amount_usd, raw, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
                 ON CONFLICT (date, player_id) DO UPDATE SET
                   player_name     = EXCLUDED.player_name,
                   total_started   = EXCLUDED.total_started,
                   total_finished  = EXCLUDED.total_finished,
                   total_viewed    = EXCLUDED.total_viewed,
                   total_clicked   = EXCLUDED.total_clicked,
                   unique_devices  = EXCLUDED.unique_devices,
                   unique_sessions = EXCLUDED.unique_sessions,
                   engagement_rate = EXCLUDED.engagement_rate,
                   play_rate       = EXCLUDED.play_rate,
                   conversion_rate = EXCLUDED.conversion_rate,
                   conversions     = EXCLUDED.conversions,
                   amount_brl      = EXCLUDED.amount_brl,
                   amount_usd      = EXCLUDED.amount_usd,
                   raw             = EXCLUDED.raw,
                   updated_at      = NOW()`,
                [
                  r.date,
                  r.player_id,
                  r.player_name,
                  r.total_started,
                  r.total_finished,
                  r.total_viewed,
                  r.total_clicked,
                  r.unique_devices,
                  r.unique_sessions,
                  r.engagement_rate,
                  r.play_rate,
                  r.conversion_rate,
                  r.conversions,
                  r.amount_brl,
                  r.amount_usd,
                  r.raw,
                ],
              );
            }
            await client.query('COMMIT');
            totalRows += rows.length;
            send({ type: 'account_done', account: label, rows: rows.length, status: 'ok' });
          } catch (dbErr: any) {
            await client.query('ROLLBACK');
            errorCount++;
            send({ type: 'account_done', account: label, rows: 0, status: 'error', error: dbErr.message });
          } finally {
            client.release();
          }
        } catch (fetchErr: any) {
          errorCount++;
          send({ type: 'account_done', account: label, rows: 0, status: 'error', error: fetchErr.message });
        }
      };

      for (let i = 0; i < players.length; i += CONCURRENCY) {
        const batch = players.slice(i, i + CONCURRENCY);
        batch.forEach((p, j) => {
          send({ type: 'progress', index: i + j + 1, total: players.length, account: p.name || p.id });
        });
        await Promise.all(batch.map(processPlayer));
      }

      send({
        type: 'done',
        totalRows,
        errorCount,
        accounts: players.length,
        dateFrom,
        dateTo,
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
