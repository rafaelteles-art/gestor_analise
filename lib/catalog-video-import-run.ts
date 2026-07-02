// Shared orchestration for catalog video fills — used by BOTH the on-demand import
// route and the scheduled-fill cron so the two never diverge (docs/adr/0008).
// This is the I/O layer; the pure parse/match logic lives in catalog-video-import.ts.
import {
  listCatalogProducts,
  getCatalogProductStats,
  bulkUpdateProductVideos,
  type BulkVideoItem,
  type BulkVideoResult,
  type CatalogProductStats,
} from './meta-product-catalogs';
import { readSheetTabCells } from './google-sheets';
import {
  parseNomenclaturaSheet,
  buildVideoImportPlan,
  baseAdNameOf,
  type MatchableProduct,
  type VideoImportPlan,
} from './catalog-video-import';

export type ResolvedVideoFill =
  | { ok: true; plan: VideoImportPlan; stats: CatalogProductStats; sheetLinkRows: number }
  | { ok: false; errors: string[] };

/** Read the catalog's missing-video products + the sheet, and build the fill plan.
 *  The products' Base Ad Names calibrate the header-independent column fallback
 *  (Plan A). No write. */
export async function resolveVideoFillPlan(
  catalogId: string,
  spreadsheetId: string,
  tabName: string,
): Promise<ResolvedVideoFill> {
  const [missing, stats] = await Promise.all([
    listCatalogProducts(catalogId, { missingVideo: true }),
    getCatalogProductStats(catalogId),
  ]);
  const products: MatchableProduct[] = missing.map((p) => ({
    product_id: p.product_id,
    retailer_id: p.retailer_id,
    name: p.name,
  }));
  const knownBaseNames = products.map((p) => baseAdNameOf(p.retailer_id));
  const cells = await readSheetTabCells(spreadsheetId, tabName);
  const parsed = parseNomenclaturaSheet(cells, knownBaseNames);
  if (parsed.errors.length) return { ok: false, errors: parsed.errors };
  const plan = buildVideoImportPlan(parsed, products);
  return { ok: true, plan, stats, sheetLinkRows: parsed.rows.length };
}

/** Write a resolved plan to Meta (ADR-0006 batched items_batch + single-pass verify). */
export async function commitVideoFillPlan(
  catalogId: string,
  plan: VideoImportPlan,
): Promise<BulkVideoResult> {
  const items: BulkVideoItem[] = plan.toFill.map((f) => ({
    product_id: f.product_id,
    retailer_id: f.retailer_id,
    video_url: f.link,
  }));
  return bulkUpdateProductVideos(catalogId, items);
}

export interface VideoFillOutcome {
  filled: BulkVideoResult['filled'];
  failed: BulkVideoResult['failed'];
  products_without_link: Array<{ product_id: string; retailer_id: string | null }>;
  unmatched_sheet_keys: string[];
  duplicate_sheet_keys: string[];
  sheet_link_rows: number;
  chunk_count: number;
  verify_rounds: number;
}

/** Resolve + commit in one call. Throws if the sheet can't be parsed. Used by the
 *  scheduled-fill cron; the plan is re-derived from a fresh sheet read (idempotent). */
export async function runVideoFill(
  catalogId: string,
  spreadsheetId: string,
  tabName: string,
): Promise<VideoFillOutcome> {
  const resolved = await resolveVideoFillPlan(catalogId, spreadsheetId, tabName);
  if (!resolved.ok) throw new Error(resolved.errors.join(' '));
  const result = await commitVideoFillPlan(catalogId, resolved.plan);
  return {
    filled: result.filled,
    failed: result.failed,
    products_without_link: resolved.plan.productsWithoutLink.map((p) => ({
      product_id: p.product_id,
      retailer_id: p.retailer_id,
    })),
    unmatched_sheet_keys: resolved.plan.unmatchedSheetKeys,
    duplicate_sheet_keys: resolved.plan.duplicateSheetKeys,
    sheet_link_rows: resolved.sheetLinkRows,
    chunk_count: result.chunk_count,
    verify_rounds: result.verify_rounds,
  };
}
