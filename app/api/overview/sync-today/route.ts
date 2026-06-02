import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getRedtrackApiKey } from '@/lib/config';

export const maxDuration = 300;

/**
 * POST /api/overview/sync-today
 *
 * Sincroniza métricas do dia (default: hoje em America/Sao_Paulo) das campanhas
 * selecionadas em Configurações direto da API do RedTrack para a tabela
 * `redtrack_metrics`. Inclui contagem por tipo de conversão (InitiateCheckout,
 * Purchase, Up1-Up4).
 *
 * Body opcional: { date?: 'YYYY-MM-DD' }   default = hoje em America/Sao_Paulo
 * Streaming NDJSON: eventos { type: 'start' | 'progress' | 'log' | 'done' | 'error' }
 */

const CONV_TYPE_MAP = {
  ic_count:       'convtype1',   // InitiateCheckout
  purchase_count: 'convtype2',   // Purchase
  up1_count:      'convtype3',
  up2_count:      'convtype4',
  up3_count:      'convtype5',
  up4_count:      'convtype11',
} as const;

const SP_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function todayInSaoPaulo(): string {
  return SP_DATE_FMT.format(new Date());
}

function parseDateInput(input: unknown): string {
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const d = new Date(`${input}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) return input;
  }
  return todayInSaoPaulo();
}

// Schema é garantido uma única vez por processo (boot). ALTER TABLE adquire
// AccessExclusiveLock no Postgres mesmo com IF NOT EXISTS, então fora do hot path.
let schemaEnsured = false;
let schemaEnsuringPromise: Promise<void> | null = null;

async function ensureSchema(): Promise<void> {
  if (schemaEnsured) return;
  if (schemaEnsuringPromise) return schemaEnsuringPromise;
  schemaEnsuringPromise = pool
    .query(`
      ALTER TABLE redtrack_metrics
        ADD COLUMN IF NOT EXISTS ic_count       integer DEFAULT 0,
        ADD COLUMN IF NOT EXISTS purchase_count integer DEFAULT 0,
        ADD COLUMN IF NOT EXISTS up1_count      integer DEFAULT 0,
        ADD COLUMN IF NOT EXISTS up2_count      integer DEFAULT 0,
        ADD COLUMN IF NOT EXISTS up3_count      integer DEFAULT 0,
        ADD COLUMN IF NOT EXISTS up4_count      integer DEFAULT 0,
        ADD COLUMN IF NOT EXISTS synced_at      timestamptz DEFAULT now();
    `)
    .then(() => { schemaEnsured = true; })
    .finally(() => { schemaEnsuringPromise = null; });
  return schemaEnsuringPromise;
}

export async function POST(req: NextRequest) {
  const apiKey = await getRedtrackApiKey();
  if (!apiKey) {
    return NextResponse.json({ error: 'REDTRACK_API_KEY não configurada.' }, { status: 500 });
  }

  let rawBody: unknown = {};
  try { rawBody = await req.json(); } catch {}
  const dateStr = parseDateInput((rawBody as { date?: unknown } | null)?.date);

  try {
    await ensureSchema();
  } catch (err) {
    console.error('[sync-today] ensureSchema failed:', err);
    return NextResponse.json({ error: 'Falha ao preparar schema.' }, { status: 500 });
  }

  let selected: { campaign_id: string; campaign_name: string }[] = [];
  try {
    const res = await pool.query(
      `SELECT campaign_id, campaign_name FROM redtrack_campaign_selections
       WHERE is_selected = true ORDER BY campaign_name ASC`,
    );
    selected = res.rows;
  } catch (err) {
    console.error('[sync-today] select campaigns failed:', err);
    return NextResponse.json({ error: 'Falha ao buscar campanhas.' }, { status: 500 });
  }

  if (selected.length === 0) {
    return NextResponse.json(
      { error: 'Nenhuma campanha selecionada. Use Configurações → Campanhas RedTrack.' },
      { status: 400 },
    );
  }

  // RedTrack limita ~40 req/min — 1500ms entre campanhas mantém folga.
  // Em 429 honra Retry-After; sem header, faz backoff exponencial capado em 5min.
  const DELAY_BETWEEN_CAMPAIGNS_MS = 1500;
  const DEFAULT_RETRY_WAIT_MS = 60_000;
  const FETCH_TIMEOUT_MS = 30_000;
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

      const failFatal = (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        try { send({ type: 'error', message, ts: Date.now() }); } catch {}
        try { controller.close(); } catch {}
      };

      try {
        const fetchCampaignReport = async (
          campaignId: string,
          tag: string,
        ): Promise<any | null> => {
          const params = new URLSearchParams({
            api_key: apiKey,
            date_from: dateStr,
            date_to: dateStr,
            tz: 'America/Sao_Paulo',
            group: 'campaign',
            campaign_id: campaignId,
          });
          const url = `https://api.redtrack.io/report?${params.toString()}`;

          for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            let res: Response;
            try {
              res = await fetch(url, {
                headers: { Accept: 'application/json' },
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
              });
            } catch (err: any) {
              const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
              if (isTimeout && attempt < MAX_RETRIES) {
                log(`Timeout em ${tag} — retry (tentativa ${attempt}/${MAX_RETRIES})`, 'warn');
                await delay(Math.min(2_000 * attempt, 30_000));
                continue;
              }
              throw err;
            }

            if (res.status === 429) {
              const retryAfter = Number(res.headers.get('retry-after'));
              const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
                ? retryAfter * 1000
                : Math.min(DEFAULT_RETRY_WAIT_MS * Math.pow(2, attempt - 1), 5 * 60_000);
              log(`429 em ${tag} — aguardando ${Math.round(waitMs / 1000)}s (tentativa ${attempt}/${MAX_RETRIES})`, 'warn');
              await delay(waitMs);
              continue;
            }

            // 5xx típico de proxy/CDN flapping — retry com backoff
            if (res.status >= 500 && res.status < 600 && attempt < MAX_RETRIES) {
              log(`HTTP ${res.status} em ${tag} — retry (tentativa ${attempt}/${MAX_RETRIES})`, 'warn');
              await delay(Math.min(2_000 * attempt, 30_000));
              continue;
            }

            if (!res.ok) {
              const text = await res.text().catch(() => '');
              throw new Error(`HTTP ${res.status} em ${tag}: ${text.slice(0, 200)}`);
            }
            const data = await res.json();
            const arr = Array.isArray(data)
              ? data
              : Array.isArray((data as any)?.data) ? (data as any).data : [];
            return arr.length > 0 ? arr[0] : null;
          }
          throw new Error(`Esgotou ${MAX_RETRIES} tentativas em ${tag}`);
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
              const num = (v: unknown) => {
                const n = Number(v);
                return Number.isFinite(n) ? n : 0;
              };
              const intNum = (v: unknown) => {
                const n = Number(v);
                return Number.isFinite(n) ? Math.trunc(n) : 0;
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
      } catch (err) {
        failFatal(err);
      }
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
