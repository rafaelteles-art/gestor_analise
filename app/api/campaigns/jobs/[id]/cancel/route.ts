import { NextResponse } from 'next/server';
import { requestCancel } from '@/lib/campaign-jobs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/campaigns/jobs/[id]/cancel
 *
 * Cancel semantics (ADR-0005):
 *   pending  → flip to 'cancelled' immediately (never started)        → 200
 *   running  → set cancel_requested; worker stops at the next entity  → 202
 *   terminal → already finished, nothing to cancel                    → 409
 *   missing  → 404
 *
 * Returns { outcome } describing what happened.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const jobId = Number(id);
  if (!Number.isFinite(jobId)) {
    return NextResponse.json({ error: 'id inválido' }, { status: 400 });
  }
  try {
    const outcome = await requestCancel(jobId);
    if (outcome === 'not_found') {
      return NextResponse.json({ error: 'não encontrado' }, { status: 404 });
    }
    if (outcome === 'not_cancellable') {
      return NextResponse.json(
        { outcome, error: 'job já finalizado' },
        { status: 409 }
      );
    }
    // 'cancelled' (was pending) → 200; 'cancel_requested' (was running) → 202.
    const httpStatus = outcome === 'cancelled' ? 200 : 202;
    return NextResponse.json({ outcome }, { status: httpStatus });
  } catch (err: any) {
    const message = err?.message ?? String(err);
    console.error('[campaigns/jobs/:id/cancel] erro:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
