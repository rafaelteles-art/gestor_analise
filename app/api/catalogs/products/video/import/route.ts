import { NextRequest, NextResponse } from 'next/server';
import { SheetReadError } from '@/lib/google-sheets';
import { DriveAuthError } from '@/lib/google-drive';
import { resolveVideoFillPlan, commitVideoFillPlan } from '@/lib/catalog-video-import-run';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300; // bulk write + multi-round verify; capped by the LB 300s wall anyway

const DEFAULT_TAB = 'NOMECLATURA ADS';

/**
 * POST /api/catalogs/products/video/import
 * Body: { catalog_id, spreadsheet_id, tab_name?, mode: 'preview' | 'commit' }
 *
 * Reads the picked Google Sheet tab, matches its "Nº CRIATIVO" base names against
 * the catalog's missing-video products (Base Ad Name), and either previews the
 * resolved buckets (mode='preview') or writes them to Meta (mode='commit').
 *
 * Commit re-derives the plan from a fresh sheet read + product list — the client
 * is never trusted to supply the write set, so the op stays idempotent. See
 * docs/adr/0006.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const catalogId = (body?.catalog_id ?? '').toString().trim();
    const spreadsheetId = (body?.spreadsheet_id ?? '').toString().trim();
    const tabName = (body?.tab_name ?? '').toString().trim() || DEFAULT_TAB;
    const mode = (body?.mode ?? 'preview').toString();

    if (!catalogId) return NextResponse.json({ success: false, error: 'catalog_id obrigatório' }, { status: 400 });
    if (!spreadsheetId) return NextResponse.json({ success: false, error: 'spreadsheet_id obrigatório' }, { status: 400 });
    if (mode !== 'preview' && mode !== 'commit') {
      return NextResponse.json({ success: false, error: "mode deve ser 'preview' ou 'commit'" }, { status: 400 });
    }

    // Resolve the plan (shared with the scheduled-fill cron — docs/adr/0008).
    const resolved = await resolveVideoFillPlan(catalogId, spreadsheetId, tabName);
    if (!resolved.ok) {
      return NextResponse.json(
        { success: false, error: resolved.errors.join(' '), parse_errors: resolved.errors },
        { status: 422 },
      );
    }
    const { plan, stats, sheetLinkRows } = resolved;

    if (mode === 'preview') {
      return NextResponse.json({
        success: true,
        mode: 'preview',
        tab: tabName,
        sheet_link_rows: sheetLinkRows,
        stats,
        plan: {
          to_fill: plan.toFill,
          products_without_link: plan.productsWithoutLink,
          unmatched_sheet_keys: plan.unmatchedSheetKeys,
          duplicate_sheet_keys: plan.duplicateSheetKeys,
        },
      });
    }

    const result = await commitVideoFillPlan(catalogId, plan);
    return NextResponse.json({
      success: true,
      mode: 'commit',
      tab: tabName,
      result,
      plan_counts: {
        to_fill: plan.toFill.length,
        products_without_link: plan.productsWithoutLink.length,
        unmatched_sheet_keys: plan.unmatchedSheetKeys.length,
        duplicate_sheet_keys: plan.duplicateSheetKeys.length,
      },
    });
  } catch (error: any) {
    const status =
      error instanceof DriveAuthError ? 403 :
      error instanceof SheetReadError ? 422 :
      error?.code === 'NO_TOKEN' ? 403 :
      500;
    console.error('POST /api/catalogs/products/video/import error:', error);
    return NextResponse.json(
      { success: false, error: error?.message ?? String(error) },
      { status },
    );
  }
}
