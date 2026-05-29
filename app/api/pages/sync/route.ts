import { NextRequest, NextResponse } from 'next/server';
import { createPageSyncJob } from '@/lib/sync-jobs';

export const dynamic = 'force-dynamic';

/**
 * POST /api/pages/sync  → enqueue a background page-sync job.
 * Body (optional): { kind?: 'refresh' | 'discovery', profiles?: string[] }.
 *   kind 'refresh'  (default) → update ad_limit/ads_running over known pages.
 *   kind 'discovery'          → walk BMs to find pages.
 * Returns { job_id, status, kind } immediately; the Cloud Scheduler poller
 * (/api/cron/pages-sync) runs the work in chunks. Poll /api/pages/sync/status?job_id=…
 */
export async function POST(req: NextRequest) {
  let kind: 'refresh' | 'discovery' = 'refresh';
  let profiles: string[] | undefined;
  try {
    const body = await req.json();
    if (body?.kind === 'discovery') kind = 'discovery';
    if (Array.isArray(body?.profiles)) {
      profiles = body.profiles.filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0);
    }
  } catch {
    // no body → defaults (refresh, all profiles)
  }
  try {
    const jobId = await createPageSyncJob({ kind, profiles });
    return NextResponse.json({ job_id: jobId, status: 'pending', kind });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
