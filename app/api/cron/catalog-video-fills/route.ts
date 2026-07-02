import { NextRequest, NextResponse } from 'next/server';
import { claimDueVideoFill, finishVideoFill } from '@/lib/catalog-video-fills';
import { getCatalogVideoSheet } from '@/lib/meta-catalogs';
import { runVideoFill } from '@/lib/catalog-video-import-run';

export const maxDuration = 300; // one catalog's batched write is wall-safe; we claim ONE per tick
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/cron/catalog-video-fills
 *
 * Disparado pelo Cloud Scheduler a cada 5 minutos (`*\/5 * * * *`, America/Sao_Paulo).
 * Reivindica UM Scheduled Video Fill vencido por vez, resolve a planilha ATUAL do
 * catálogo (lida fresca — pode ter mudado desde o arme), roda uma vez (sem retry) e
 * grava o resultado. Fills ficam devidos no fire_at (08:30 GMT-3); muitos catálogos
 * escoam ao longo de vários ticks.
 *
 * Auth: header `Authorization: Bearer <CRON_SECRET>` ou `?key=<CRON_SECRET>`.
 * Ver docs/adr/0008.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET não configurado.' }, { status: 500 });
  }

  const provided = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    || (req.nextUrl.searchParams.get('key') ?? '');
  if (provided !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const fill = await claimDueVideoFill();
  if (!fill) return NextResponse.json({ ran: false, reason: 'no due fill' });

  const startedAt = Date.now();
  try {
    const sheet = await getCatalogVideoSheet(fill.catalog_id);
    if (!sheet) {
      await finishVideoFill(fill.id, 'failed', { error: 'catálogo sem planilha vinculada no momento da execução' });
      return NextResponse.json({ ran: true, ok: false, fill_id: fill.id, reason: 'no sheet linked' });
    }
    const outcome = await runVideoFill(fill.catalog_id, sheet.spreadsheet_id, sheet.tab);
    await finishVideoFill(fill.id, 'done', { ...outcome, elapsed_ms: Date.now() - startedAt });
    return NextResponse.json({
      ran: true,
      ok: true,
      fill_id: fill.id,
      catalog_id: fill.catalog_id,
      filled: outcome.filled.length,
      still_missing: outcome.products_without_link.length,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (err: any) {
    const message = err?.message ?? String(err);
    await finishVideoFill(fill.id, 'failed', { error: message, elapsed_ms: Date.now() - startedAt });
    return NextResponse.json({ ran: true, ok: false, fill_id: fill.id, error: message }, { status: 207 });
  }
}
