import { NextResponse } from 'next/server';
import { getJob } from '@/lib/campaign-jobs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/campaigns/jobs/[id]
 *
 * Full job row including payload, run_state, and the per-entity event log.
 * Used by the fila detail expand and re-enqueue. Returns { job } or 404.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const jobId = Number(id);
  if (!Number.isFinite(jobId)) {
    return NextResponse.json({ error: 'id inválido' }, { status: 400 });
  }
  try {
    const job = await getJob(jobId);
    if (!job) return NextResponse.json({ error: 'não encontrado' }, { status: 404 });
    return NextResponse.json({ job });
  } catch (err: any) {
    const message = err?.message ?? String(err);
    console.error('[campaigns/jobs/:id] erro:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
