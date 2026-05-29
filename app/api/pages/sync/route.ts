import { NextRequest, NextResponse } from 'next/server';
import { createPageSyncJob } from '@/lib/sync-jobs';

export const dynamic = 'force-dynamic';

/**
 * POST /api/pages/sync  → enqueue a background page sync.
 * Body (optional): { profiles: string[] }. Returns { job_id } immediately;
 * the Cloud Scheduler poller (/api/cron/pages-sync) runs the actual work.
 * Poll /api/pages/sync/status?job_id=… for progress.
 */
export async function POST(req: NextRequest) {
  let profiles: string[] | undefined;
  try {
    const body = await req.json();
    if (Array.isArray(body?.profiles)) {
      profiles = body.profiles.filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0);
    }
  } catch {
    // no body → sync all
  }
  try {
    const jobId = await createPageSyncJob(profiles);
    return NextResponse.json({ job_id: jobId, status: 'pending' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
