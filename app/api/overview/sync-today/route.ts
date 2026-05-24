import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getRedtrackApiKey } from '@/lib/config';
import { format } from 'date-fns';

export const maxDuration = 300;

/**
 * POST /api/overview/sync-today
 *
 * Sincroniza métricas do dia (default: hoje) das campanhas selecionadas em Configurações
 * direto da API do RedTrack para a tabela `redtrack_metrics`. Inclui contagem por
 * tipo de conversão (InitiateCheckout, Purchase, Up1-Up4).
 *
 * Body opcional: { date?: 'YYYY-MM-DD' }   default = hoje em America/Sao_Paulo
 * Streaming NDJSON: eventos { type: 'start' | 'progress' | 'done' | 'error' }
 */

const CONV_TYPE_MAP = {
  ic_count:       'convtype1',   // InitiateCheckout
  purchase_count: 'convtype2',   // Purchase
  up1_count:      'convtype3',
  up2_count:      'convtype4',
  up3_count:      'convtype5',
  up4_count:      'convtype11',
} as const;

async function ensureSchema() {
  await pool.query(`
    ALTER TABLE redtrack_metrics
      ADD COLUMN IF NOT EXISTS ic_count       integer DEFAULT 0,
      ADD COLUMN IF NOT EXISTS purchase_count integer DEFAULT 0,
      ADD COLUMN IF NOT EXISTS up1_count      integer DEFAULT 0,
      ADD COLUMN IF NOT EXISTS up2_count      integer DEFAULT 0,
      ADD COLUMN IF NOT EXISTS up3_count      integer DEFAULT 0,
      ADD COLUMN IF NOT EXISTS up4_count      integer DEFAULT 0,
      ADD COLUMN IF NOT EXISTS synced_at      timestamptz DEFAULT now();
  `);
}

export async function POST(req: NextRequest) {
  const apiKey = await getRedtrackApiKey();
  if (!apiKey) {
    return NextResponse.json({ error: 'REDTRACK_API_KEY não configurada.' }, { status: 500 });
  }

  let body: any = {};
  try { body = await req.json(); } catch {}
  const dateStr: string = body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
    ? body.date
    : format(new Date(), 'yyyy-MM-dd');

  try {
    await ensureSchema();
  } catch (err: any) {
    return NextResponse.json({ error: 'Erro ao garantir schema: ' + err.message }, { status: 500 });
  }

  // Campanhas selecionadas
  let selected: { campaign_id: string; campaign_name: string }[] = [];
  try {
    const res = await pool.query(
      `SELECT campaign_id, campaign_name FROM redtrack_campaign_selections
       WHERE is_selected = true ORDER BY campaign_name ASC`,
    );
    selected = res.rows;
  } catch (err: any) {
    return NextResponse.json({ error: 'Erro ao buscar campanhas: ' + err.message }, { status: 500 });
  }

  if (selected.length === 0) {
    return NextResponse.json(
      { error: 'Nenhuma campanha selecionada. Use Configurações → Campanhas RedTrack.' },
      { status: 400 },
    );
  }

  const DELAY_BETWEEN_CAMPAIGNS_MS = 1500;
  const RETRY_WAIT_MS = 60000;
  const MAX_RETRIES = 5;
  const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')); } catch {}
      };
      const log = (message: string, level: 'info' | 'warn' | 'error' = 'info') =>
        send({ type: 'log', level, message, ts: Date.now() });

      const fetchCampaignReport = async (campaignId: string, tag: string): Promise<any | null> => {
        const url = `https://api.redtrack.io/report?api_key=${apiKey}` +
                    `&date_from=${dateStr}&date_to=${dateStr}` +
                    `&tz=America/Sao_Paulo&group=campaign&campaign_id=${campaignId}`;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          const res = await fetch(url, { headers: { Accept: 'application/json' } });
          if (res.status === 429) {
            log(`429 em ${tag} — aguardando ${RETRY_WAIT_MS / 1000}s (tentativa ${attempt}/${MAX_RETRIES})`, 'warn');
            await delay(RETRY_WAIT_MS);
            continue;
          }
          if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status} em ${tag}: ${text.slice(0, 200)}`);
          }
          const data = await res.json();
          const arr = Array.isArray(data) ? data : (data?.data || []);
          // /report?group=campaign&campaign_id=X retorna 1 linha (ou 0 se sem atividade)
          return arr.length > 0 ? arr[0] : null;
        }
        throw new Error(`Esgotou ${MAX_RETRIES} tentativas por rate limit em ${tag}`);
      };

      send({ type: 'start', total: selected.length, date: dateStr });
      log(`Sincronização Overview iniciada · ${selected.length} campanha(s) · ${dateStr}`);

      let synced = 0;
      let errorCount = 0;

      for (let i = 0; i < selected.length; i++) {
        const camp = selected[i];
        const idx = i + 1;

        send({ type: 'progress', index: idx, total: selected.length, campaign: camp.campaign_name });

        try {
          const row = await fetchCampaignReport(camp.campaign_id, camp.campaign_name);

          if (!row) {
            // Sem atividade — zera os valores no banco para refletir
            await pool.query(
              `INSERT INTO redtrack_metrics
                 (date, campaign_id, campaign_name, clicks, conversions, total_conversions,
                  revenue, total_revenue, cost, profit, roas,
                  ic_count, purchase_count, up1_count, up2_count, up3_count, up4_count, synced_at)
               VALUES ($1,$2,$3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,NOW())
               ON CONFLICT (date, campaign_id) DO UPDATE SET
                 campaign_name = EXCLUDED.campaign_name,
                 clicks = 0, conversions = 0, total_conversions = 0,
                 revenue = 0, total_revenue = 0, cost = 0, profit = 0, roas = 0,
                 ic_count = 0, purchase_count = 0,
                 up1_count = 0, up2_count = 0, up3_count = 0, up4_count = 0,
                 synced_at = NOW();`,
              [dateStr, camp.campaign_id, camp.campaign_name],
            );
            log(`  · ${camp.campaign_name}: sem atividade no dia (zerado)`);
          } else {
            const num = (v: any) => {
              const n = parseFloat(v);
              return Number.isFinite(n) ? n : 0;
            };
            const intNum = (v: any) => {
              const n = parseInt(v, 10);
              return Number.isFinite(n) ? n : 0;
            };

            const values = [
              dateStr,
              camp.campaign_id,
              row.campaign || camp.campaign_name,
              intNum(row.clicks),
              intNum(row.conversions),
              intNum(row.total_conversions),
              num(row.revenue),
              num(row.total_revenue),
              num(row.cost),
              num(row.profit),
              num(row.roas),
              intNum(row[CONV_TYPE_MAP.ic_count]),
              intNum(row[CONV_TYPE_MAP.purchase_count]),
              intNum(row[CONV_TYPE_MAP.up1_count]),
              intNum(row[CONV_TYPE_MAP.up2_count]),
              intNum(row[CONV_TYPE_MAP.up3_count]),
              intNum(row[CONV_TYPE_MAP.up4_count]),
            ];

            await pool.query(
              `INSERT INTO redtrack_metrics
                 (date, campaign_id, campaign_name, clicks, conversions, total_conversions,
                  revenue, total_revenue, cost, profit, roas,
                  ic_count, purchase_count, up1_count, up2_count, up3_count, up4_count, synced_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
               ON CONFLICT (date, campaign_id) DO UPDATE SET
                 campaign_name      = EXCLUDED.campaign_name,
                 clicks             = EXCLUDED.clicks,
                 conversions        = EXCLUDED.conversions,
                 total_conversions  = EXCLUDED.total_conversions,
                 revenue            = EXCLUDED.revenue,
                 total_revenue      = EXCLUDED.total_revenue,
                 cost               = EXCLUDED.cost,
                 profit             = EXCLUDED.profit,
                 roas               = EXCLUDED.roas,
                 ic_count           = EXCLUDED.ic_count,
                 purchase_count     = EXCLUDED.purchase_count,
                 up1_count          = EXCLUDED.up1_count,
                 up2_count          = EXCLUDED.up2_count,
                 up3_count          = EXCLUDED.up3_count,
                 up4_count          = EXCLUDED.up4_count,
                 synced_at          = NOW();`,
              values,
            );

            log(`  ✓ ${camp.campaign_name}: cost R$ ${num(row.cost).toFixed(2)} · rev R$ ${num(row.total_revenue).toFixed(2)} · ROAS ${num(row.roas).toFixed(2)}x`);
          }

          synced++;
        } catch (err: any) {
          errorCount++;
          log(`  ✗ ${camp.campaign_name}: ${err.message}`, 'error');
        }

        if (idx < selected.length) await delay(DELAY_BETWEEN_CAMPAIGNS_MS);
      }

      log(`Concluído · ${synced} campanha(s) sincronizada(s) · ${errorCount} erro(s)`,
          errorCount > 0 ? 'warn' : 'info');
      send({ type: 'done', synced, errorCount, date: dateStr });
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
