import { NextRequest, NextResponse } from 'next/server';
import { claimNextPageSyncJob, updateJobProgress, completeJob, failJob } from '@/lib/sync-jobs';
import { runPageSyncJob } from '@/lib/meta-pages';

export const maxDuration = 1200;
export const dynamic = 'force-dynamic';

/**
 * POST /api/cron/pages-sync
 * Triggered by Cloud Scheduler (~every 2 min). Claims the oldest runnable
 * page_sync_jobs row (skip-locked + lease) and runs it on the 1200s channel.
 * Auth: Authorization: Bearer <CRON_SECRET>  or  ?key=<CRON_SECRET>.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET não configurado.' }, { status: 500 });
  const provided = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    || (req.nextUrl.searchParams.get('key') ?? '');
  if (provided !== secret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const job = await claimNextPageSyncJob();
  if (!job) return NextResponse.json({ ran: false, reason: 'no pending job' });

  try {
    const result = await runPageSyncJob({
      profileNames: job.profiles ?? undefined,
      onProgress: (p) => { void updateJobProgress(job.id, p); },
    });
    await completeJob(job.id, {
      pagesSynced: result.count,
      partial: result.partial,
      message: result.partial
        ? `Salvo parcial: ${result.count} páginas (rate limit do app — tente o restante em ~1h).`
        : `Sincronizado: ${result.count} páginas.`,
    });
    return NextResponse.json({ ran: true, job_id: job.id, ...result });
  } catch (err: any) {
    await failJob(job.id, err?.message ?? String(err));
    return NextResponse.json({ ran: true, job_id: job.id, error: err?.message ?? String(err) }, { status: 207 });
  }
}
