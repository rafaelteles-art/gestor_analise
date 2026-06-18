import { NextRequest, NextResponse } from 'next/server';
import {
  listCatalogProducts,
  getCatalogProductStats,
  bulkUpdateProductVideos,
  type BulkVideoItem,
} from '@/lib/meta-product-catalogs';
import { readSheetTabCells, SheetReadError } from '@/lib/google-sheets';
import { DriveAuthError } from '@/lib/google-drive';
import {
  parseNomenclaturaSheet,
  buildVideoImportPlan,
  type MatchableProduct,
} from '@/lib/catalog-video-import';

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

    // 1) Read + parse the sheet tab (grid cells, so hyperlinks yield their URL).
    const cells = await readSheetTabCells(spreadsheetId, tabName);
    const parsed = parseNomenclaturaSheet(cells);
    if (parsed.errors.length) {
      return NextResponse.json(
        { success: false, error: parsed.errors.join(' '), parse_errors: parsed.errors },
        { status: 422 },
      );
    }

    // 2) Build the plan against the current missing-video products.
    const [missing, stats] = await Promise.all([
      listCatalogProducts(catalogId, { missingVideo: true }),
      getCatalogProductStats(catalogId),
    ]);
    const products: MatchableProduct[] = missing.map((p) => ({
      product_id: p.product_id,
      retailer_id: p.retailer_id,
      name: p.name,
    }));
    const plan = buildVideoImportPlan(parsed, products);

    const planPayload = {
      to_fill: plan.toFill,
      products_without_link: plan.productsWithoutLink,
      unmatched_sheet_keys: plan.unmatchedSheetKeys,
      duplicate_sheet_keys: plan.duplicateSheetKeys,
    };

    if (mode === 'preview') {
      return NextResponse.json({
        success: true,
        mode: 'preview',
        tab: tabName,
        sheet_link_rows: parsed.rows.length,
        stats,
        plan: planPayload,
      });
    }

    // 3) Commit — write matched products to Meta and verify.
    const items: BulkVideoItem[] = plan.toFill.map((f) => ({
      product_id: f.product_id,
      retailer_id: f.retailer_id,
      video_url: f.link,
    }));
    const result = await bulkUpdateProductVideos(catalogId, items);

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
