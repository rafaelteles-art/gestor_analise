import { NextRequest, NextResponse } from 'next/server';
import { runQueueTick } from '@/lib/campaign-jobs';

export const maxDuration = 1200;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/cron/campaigns-queue
 *
 * The safety-net poller for the per-Profile campaign job queue (ADR-0005).
 * Cloud Scheduler hits this every 2 minutes (`*​/2 * * * *`, America/Sao_Paulo).
 * It drains runnable jobs within a ~270s budget; per-Profile FIFO serialization
 * is enforced inside the claim, so two ticks (or a tick + the browser kick) never
 * run the same Profile concurrently.
 *
 * Auth: header `Authorization: Bearer <CRON_SECRET>` or `?key=<CRON_SECRET>` —
 * the exact pattern used by /api/cron/accounts-sync.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET não configurado.' }, { status: 500 });
  }

  const provided = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    || (req.nextUrl.searchParams.get('key') ?? '');
  if (provided !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { claimed, finished } = await runQueueTick();
    return NextResponse.json({ claimed, finished });
  } catch (err: any) {
    const message = err?.message ?? String(err);
    console.error('[cron/campaigns-queue] erro:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
