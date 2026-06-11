import { NextResponse } from 'next/server';
import { runQueueTick } from '@/lib/campaign-jobs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Cloud Run hard timeout is 300s; keep the tick budget (270s default) inside it.
export const maxDuration = 300;

/**
 * POST /api/campaigns/queue/tick
 *
 * The browser "kick": the builder calls this right after enqueueing so the
 * worker starts within a couple seconds instead of waiting for the 2-min cron
 * poller. Same open/session auth as the sibling campaign routes (presets,
 * audiences, …) — relies on app-level auth, no Bearer secret. Body: `{}`.
 *
 * Drains runnable jobs within the default budget and returns the same shape as
 * the cron route.
 */
export async function POST() {
  try {
    const { claimed, finished } = await runQueueTick();
    return NextResponse.json({ claimed, finished });
  } catch (err: any) {
    const message = err?.message ?? String(err);
    console.error('[campaigns/queue/tick] erro:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
