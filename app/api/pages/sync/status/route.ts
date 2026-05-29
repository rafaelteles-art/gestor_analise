import { NextRequest, NextResponse } from 'next/server';
import { getJob } from '@/lib/sync-jobs';

export const dynamic = 'force-dynamic';

/** GET /api/pages/sync/status?job_id=123 → current job state for UI polling. */
export async function GET(req: NextRequest) {
  const idRaw = req.nextUrl.searchParams.get('job_id');
  const id = Number(idRaw);
  if (!idRaw || Number.isNaN(id)) {
    return NextResponse.json({ error: 'job_id obrigatório' }, { status: 400 });
  }
  try {
    const job = await getJob(id);
    if (!job) return NextResponse.json({ error: 'job não encontrado' }, { status: 404 });
    return NextResponse.json({
      job_id: job.id,
      status: job.status,
      message: job.message,
      current: job.current,
      total: job.total,
      pages_synced: job.pages_synced,
      partial: job.partial,
      error: job.error,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
