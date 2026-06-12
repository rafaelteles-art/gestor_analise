import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { runQueueTick } from '@/lib/campaign-jobs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Cloud Run hard timeout is 300s; keep the tick budget (270s default) inside it.
export const maxDuration = 300;

/**
 * POST /api/campaigns/queue/tick
 *
 * The browser "kick": the builder calls this right after enqueueing so the
 * worker starts within a couple seconds instead of waiting for the cron poller.
 * Drains runnable jobs within the default budget and returns the same shape as
 * the cron route (`{ claimed, finished }`). Body: `{}`.
 *
 * AUTH — this tick claims jobs and creates real Meta campaigns (real ad spend),
 * so it is gated two ways (either passes):
 *  1. NextAuth session: the whole app sits behind `proxy.ts` (this Next fork's
 *     middleware = `auth`), whose `authorized()` callback already requires a
 *     logged-in `@v2globalteam.com` user for every `/api/*` path. We re-check
 *     `await auth()` IN the handler too (defense-in-depth) so the money-spending
 *     worker is never reachable unauthenticated even if the proxy matcher is
 *     ever misconfigured. The browser kick is a same-origin fetch, so the
 *     session cookie flows through automatically.
 *  2. Bearer `CRON_SECRET`: lets trusted server-to-server callers drive the
 *     worker without a session, mirroring /api/cron/campaigns-queue.
 */
export async function POST(req: NextRequest) {
  // Path 2: shared-secret bypass for server-to-server callers (same header
  // shape as the cron route). Only honored when CRON_SECRET is configured.
  const secret = process.env.CRON_SECRET;
  const provided = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    || (req.nextUrl.searchParams.get('key') ?? '');
  const secretOk = !!secret && provided === secret;

  // Path 1: authenticated session (any logged-in user — same bar the proxy
  // enforces for /api/*). Skipped if the secret already authorized the request.
  if (!secretOk) {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const { claimed, finished } = await runQueueTick();
    return NextResponse.json({ claimed, finished });
  } catch (err: any) {
    const message = err?.message ?? String(err);
    console.error('[campaigns/queue/tick] erro:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
