import { NextRequest, NextResponse } from 'next/server';
import { claimNextPageSyncJob, updateJobProgress, completeJob, failJob, advanceProfileState, type ProfileSyncState } from '@/lib/sync-jobs';
import { runProfileSyncChunk } from '@/lib/meta-pages';

export const maxDuration = 1200;
export const dynamic = 'force-dynamic';

const INITIAL_STATE: ProfileSyncState = {
  profileIndex: 0,
  phase: 'pages',
  accounts: null,
  accountOffset: 0,
  failed: [],
};

/**
 * POST /api/cron/pages-sync
 * Triggered by Cloud Scheduler (~every 2 min). Claims the oldest runnable
 * page_sync_jobs row (skip-locked + lease) and runs one chunk of the per-profile
 * sync on the 1200s channel. Auth: Authorization: Bearer <CRON_SECRET>  or  ?key=<CRON_SECRET>.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET não configurado.' }, { status: 500 });
  const provided = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    || (req.nextUrl.searchParams.get('key') ?? '');
  if (provided !== secret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const job = await claimNextPageSyncJob();
  if (!job) return NextResponse.json({ ran: false, reason: 'no runnable job' });

  // Only per-profile jobs are enqueued now; reject any legacy refresh/discovery rows.
  if (job.kind !== 'profile') {
    await failJob(job.id, `kind '${job.kind}' não é mais suportado — use o sync por perfil.`);
    return NextResponse.json({ ran: true, job_id: job.id, error: 'unsupported kind' }, { status: 207 });
  }

  try {
    const state = job.state ?? INITIAL_STATE;
    const r = await runProfileSyncChunk({
      state,
      profileNames: job.profiles ?? undefined,
      onProgress: (p) => { void updateJobProgress(job.id, p); },
    });

    if (r.done) {
      const failed = r.state.failed ?? [];
      const message = failed.length
        ? `Sync por perfil concluído (${r.total} perfis). Falharam (token?): ${failed.join(', ')}.`
        : `Sync por perfil concluído (${r.total} perfis).`;
      await completeJob(job.id, { pagesSynced: r.total, partial: failed.length > 0, message });
      return NextResponse.json({ ran: true, kind: 'profile', job_id: job.id, done: true, failed });
    }

    await advanceProfileState(job.id, {
      state: r.state,
      cursor: r.state.profileIndex,
      current: r.state.profileIndex,
      total: r.total,
      message: r.partial
        ? `Pausa rate-limit (#4) no perfil ${r.state.profileIndex + 1}/${r.total} — retoma no próximo tick`
        : `Perfil ${r.state.profileIndex + 1}/${r.total} em andamento`,
    });
    return NextResponse.json({ ran: true, kind: 'profile', job_id: job.id, done: false, partial: r.partial });
  } catch (err: any) {
    await failJob(job.id, err?.message ?? String(err));
    return NextResponse.json({ ran: true, job_id: job.id, error: err?.message ?? String(err) }, { status: 207 });
  }
}
