import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * POST /api/cron/daily-sync
 *
 * Disparado pelo Cloud Scheduler todo dia às 04:00 (America/Sao_Paulo).
 * Roda os 3 syncs de "ontem" em paralelo: meta-bulk, rt-bulk, vturb-bulk.
 *
 * Auth: header `Authorization: Bearer <CRON_SECRET>` ou `?key=<CRON_SECRET>`.
 * O Cloud Scheduler injeta esse header automaticamente quando configurado
 * com `--headers="Authorization=Bearer ..."`.
 *
 * Cada bulk responde NDJSON streaming. Aqui consumimos o stream até o fim
 * e extraímos só o evento `done` final, pra devolver um resumo enxuto.
 */
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

  const origin = req.nextUrl.origin;
  const startedAt = Date.now();

  const runBulk = async (slug: 'meta-bulk' | 'rt-bulk' | 'vturb-bulk') => {
    const t0 = Date.now();
    try {
      const res = await fetch(`${origin}/api/sync/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'yesterday' }),
      });

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '');
        return { slug, ok: false, status: res.status, error: text.slice(0, 300), elapsedMs: Date.now() - t0 };
      }

      // Consome NDJSON e captura só o último evento `done` (ou erro).
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

  const results = await Promise.all([
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
