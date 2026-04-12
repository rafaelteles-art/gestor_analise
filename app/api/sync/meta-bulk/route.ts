import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { fetchMetaMetricsPerDay } from '@/lib/meta';
import { format, subDays } from 'date-fns';

/**
 * POST /api/sync/meta-bulk
 *
 * Busca dados diários de campanha dos últimos N dias (padrão: 30) de TODAS
 * as contas Meta selecionadas (is_selected = true) e grava em meta_ads_metrics.
 *
 * Body (opcional):
 *   { days?: number }   — quantos dias retroativos buscar (máx. 90, padrão: 30)
 *
 * Retorna progresso em streaming JSON (NDJSON) para que a UI mostre o andamento
 * conta a conta, sem timeout.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const days: number = Math.min(Math.max(parseInt(body.days ?? '30', 10), 1), 90);

  const dateTo   = format(new Date(), 'yyyy-MM-dd');
  const dateFrom = format(subDays(new Date(), days - 1), 'yyyy-MM-dd');

  // Busca todas as contas selecionadas
  let accounts: { account_id: string; account_name: string; access_token: string }[] = [];
  try {
    const res = await pool.query(
      `SELECT account_id, account_name, access_token
       FROM meta_ad_accounts
       WHERE is_selected = true
       ORDER BY account_name ASC`
    );
    accounts = res.rows;
  } catch (err: any) {
    return NextResponse.json({ error: 'Erro ao buscar contas: ' + err.message }, { status: 500 });
  }

  if (accounts.length === 0) {
    return NextResponse.json({ error: 'Nenhuma conta selecionada. Ative contas em Configurações.' }, { status: 400 });
  }

  // ── Streaming NDJSON para mostrar progresso ao vivo ──────────────────────
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      };

      send({ type: 'start', total: accounts.length, dateFrom, dateTo, days });

      let totalRows = 0;
      let errorCount = 0;

      for (let i = 0; i < accounts.length; i++) {
        const acc = accounts[i];
        send({ type: 'progress', index: i + 1, total: accounts.length, account: acc.account_name });

        try {
          const metrics = await fetchMetaMetricsPerDay(acc.account_id, dateFrom, dateTo, acc.access_token);

          if (metrics.length === 0) {
            send({ type: 'account_done', account: acc.account_name, rows: 0, status: 'empty' });
            continue;
          }

          // Upsert em lote dentro de uma transação por conta
          const client = await pool.connect();
          try {
            await client.query('BEGIN');

            for (const row of metrics) {
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
                  row.date,
                  row.account_id,
                  row.campaign_id,
                  row.campaign_name,
                  row.spend,
                  row.impressions,
                  row.clicks,
                  row.conversions,
                  row.ctr,
                  row.cpm,
                ]
              );
            }

            await client.query('COMMIT');
            totalRows += metrics.length;
            send({ type: 'account_done', account: acc.account_name, rows: metrics.length, status: 'ok' });
          } catch (dbErr: any) {
            await client.query('ROLLBACK');
            errorCount++;
            send({ type: 'account_done', account: acc.account_name, rows: 0, status: 'error', error: dbErr.message });
          } finally {
            client.release();
          }
        } catch (fetchErr: any) {
          errorCount++;
          send({ type: 'account_done', account: acc.account_name, rows: 0, status: 'error', error: fetchErr.message });
        }
      }

      send({
        type: 'done',
        totalRows,
        errorCount,
        accounts: accounts.length,
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
