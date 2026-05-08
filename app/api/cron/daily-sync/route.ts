import { NextRequest, NextResponse } from 'next/server';
import { POST as metaBulkPOST } from '@/app/api/sync/meta-bulk/route';
import { POST as rtBulkPOST } from '@/app/api/sync/rt-bulk/route';
import { POST as vturbBulkPOST } from '@/app/api/sync/vturb-bulk/route';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * POST /api/cron/daily-sync
 *
 * Disparado pelo Cloud Scheduler todo dia às 04:00 (America/Sao_Paulo).
 * Roda os 3 syncs de "ontem" em paralelo: meta-bulk, rt-bulk, vturb-bulk.
 *
 * Auth: header `Authorization: Bearer <CRON_SECRET>` ou `?key=<CRON_SECRET>`.
 *
 * Importa os handlers diretamente em vez de fetch via HTTP — evita problemas
 * com origin (req.nextUrl.origin retorna URL interna no Cloud Run) e dispensa
 * passagem pelo middleware nas rotas filhas. Cada handler responde NDJSON
 * streaming; consumimos até o fim e extraímos só o evento `done` final.
 */
type BulkSlug = 'meta-bulk' | 'rt-bulk' | 'vturb-bulk';
type BulkHandler = (req: NextRequest) => Promise<Response>;

const handlers: Record<BulkSlug, BulkHandler> = {
  'meta-bulk': metaBulkPOST as BulkHandler,
  'rt-bulk': rtBulkPOST as BulkHandler,
  'vturb-bulk': vturbBulkPOST as BulkHandler,
};

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET não configurado.' }, { status: 500 });
  }

  const authHeader = req.headers.get('authorization') ?? '';
  const queryKey = req.nextUrl.searchParams.get('key') ?? '';
  const provided = authHeader.replace(/^Bearer\s+/i, '') || queryKey;

  if (provided !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();

  const runBulk = async (slug: BulkSlug) => {
    const t0 = Date.now();
    try {
      const fakeReq = new Request(`http://internal/api/sync/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'yesterday' }),
      }) as NextRequest;

      const res = await handlers[slug](fakeReq);

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '');
        return { slug, ok: false, status: res.status, error: text.slice(0, 300), elapsedMs: Date.now() - t0 };
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let lastDone: any = null;
      let lastError: any = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.type === 'done') lastDone = evt;
            else if (evt.type === 'error') lastError = evt;
          } catch {
            // ignora linhas mal-formadas
          }
        }
      }

      if (lastError) {
        return { slug, ok: false, error: lastError.error ?? 'erro no stream', elapsedMs: Date.now() - t0 };
      }
      return { slug, ok: true, summary: lastDone, elapsedMs: Date.now() - t0 };
    } catch (err: any) {
      return { slug, ok: false, error: err?.message ?? String(err), elapsedMs: Date.now() - t0 };
    }
  };

  const results = await Promise.all<ReturnType<typeof runBulk>>([
    runBulk('meta-bulk'),
    runBulk('rt-bulk'),
    runBulk('vturb-bulk'),
  ]);

  const allOk = results.every(r => r.ok);

  return NextResponse.json(
    {
      success: allOk,
      totalElapsedMs: Date.now() - startedAt,
      results,
    },
    { status: allOk ? 200 : 207 },
  );
}
