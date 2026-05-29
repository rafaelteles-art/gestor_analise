import { NextRequest, NextResponse } from 'next/server';
import { claimNextPageSyncJob, updateJobProgress, completeJob, failJob, advanceAndRelease } from '@/lib/sync-jobs';
import { runRefreshChunk, runDiscoveryChunk } from '@/lib/meta-pages';

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
  if (!job) return NextResponse.json({ ran: false, reason: 'no runnable job' });

  try {
    if (job.kind === 'discovery') {
      const r = await runDiscoveryChunk({
        profileIndex: job.cursor,
        profileNames: job.profiles ?? undefined,
        onProgress: (p) => { void updateJobProgress(job.id, p); },
      });
      const { done: _dD, ...rRest } = r;
      if (r.done) {
        await completeJob(job.id, { pagesSynced: r.total, partial: false, message: `Descoberta concluída: ${r.total} perfil(is).` });
        return NextResponse.json({ ran: true, kind: 'discovery', job_id: job.id, done: true, ...rRest });
      }
      await advanceAndRelease(job.id, { cursor: r.nextIndex, current: r.nextIndex, total: r.total, message: `Descoberta: ${r.nextIndex}/${r.total} perfis` });
      return NextResponse.json({ ran: true, kind: 'discovery', job_id: job.id, done: false, ...rRest });
    }

    // kind === 'refresh'
    const r = await runRefreshChunk({
      offset: job.cursor,
      onProgress: (p) => { void updateJobProgress(job.id, p); },
    });
    const { done: _dR, ...rRest } = r;
    if (r.done) {
      await completeJob(job.id, { pagesSynced: r.total, partial: false, message: `Limites atualizados: ${r.total} contas.` });
      return NextResponse.json({ ran: true, kind: 'refresh', job_id: job.id, done: true, ...rRest });
    }
    await advanceAndRelease(job.id, {
      cursor: r.nextOffset,
      current: Math.min(r.nextOffset, r.total),
      total: r.total,
      message: r.partial
        ? `Pausa rate-limit (#4) em ${Math.min(r.nextOffset, r.total)}/${r.total} — retoma no próximo tick`
        : `Limites: ${Math.min(r.nextOffset, r.total)}/${r.total} contas`,
    });
    return NextResponse.json({ ran: true, kind: 'refresh', job_id: job.id, done: false, ...rRest });
  } catch (err: any) {
    await failJob(job.id, err?.message ?? String(err));
    return NextResponse.json({ ran: true, job_id: job.id, error: err?.message ?? String(err) }, { status: 207 });
  }
}
