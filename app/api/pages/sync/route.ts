import { NextRequest, NextResponse } from 'next/server';
import { createPageSyncJob } from '@/lib/sync-jobs';

export const dynamic = 'force-dynamic';

/**
 * POST /api/pages/sync  → enqueue a background per-profile page-sync job.
 * Body (optional): { profiles?: string[] }.
 *   profiles  → sync only these profiles (in order). Omitted/empty = all configured.
 * Each profile runs the standalone-style pass (me/accounts pages + me/adaccounts +
 * ads_volume limits), scoped to its own token. Returns { job_id, status, kind }
 * immediately; the Cloud Scheduler poller (/api/cron/pages-sync) runs it in chunks.
 * Poll /api/pages/sync/status?job_id=…
 */
export async function POST(req: NextRequest) {
  let profiles: string[] | undefined;
  try {
    const body = await req.json();
    if (Array.isArray(body?.profiles)) {
      profiles = body.profiles.filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0);
    }
  } catch {
    // no body → sync all configured profiles
  }
  try {
    const jobId = await createPageSyncJob({ kind: 'profile', profiles });
    return NextResponse.json({ job_id: jobId, status: 'pending', kind: 'profile' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
