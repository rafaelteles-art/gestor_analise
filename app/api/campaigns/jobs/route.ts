import { NextRequest, NextResponse } from 'next/server';
import { listJobs } from '@/lib/campaign-jobs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/campaigns/jobs
 *
 * Lightweight list (no payload) for the queue widget + /campaigns/fila page.
 * Query params:
 *   status     — exact status filter (pending|running|done|done_with_errors|error|cancelled)
 *   profile    — profile_name filter
 *   active=1   — only pending|running (takes precedence over status)
 *   limit      — page size (default 50, max 200)
 *   before_id  — keyset pagination: only jobs with id < before_id
 *
 * Returns { jobs: CampaignJobListRow[] }, newest first.
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const limitRaw = sp.get('limit');
    const beforeRaw = sp.get('before_id');
    const jobs = await listJobs({
      status: sp.get('status') ?? undefined,
      profile: sp.get('profile') ?? undefined,
      active: sp.get('active') === '1' || sp.get('active') === 'true',
      limit: limitRaw ? Number(limitRaw) : undefined,
      before_id: beforeRaw ? Number(beforeRaw) : undefined,
    });
    return NextResponse.json({ jobs });
  } catch (err: any) {
    const message = err?.message ?? String(err);
    console.error('[campaigns/jobs] erro:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
