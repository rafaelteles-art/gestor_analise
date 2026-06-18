// Bulk catalog-video import — PURE parse + match logic (no I/O).
//
// Feature: in the /catalogo "Vídeos" modal, instead of typing one video URL per
// product, the user picks a Drive spreadsheet (tab "NOMECLATURA ADS") and the app
// fills missing-video products by matching the sheet's "Nº CRIATIVO" column
// (the Base Ad Name) against each product's retailer_id with the trailing date
// token stripped.
//
// Design: docs/adr/0006-catalog-video-bulk-import.md
// Glossary (Base Ad Name, Product Set): CONTEXT.md
//
// Kept pure + deterministic so the sheet parsing and matching can be unit-tested
// without Google APIs, Postgres, or React. The Sheets read lives in
// lib/google-sheets.ts; the Meta write lives in lib/meta-product-catalogs.ts.

import { stripTrailingDateToken } from './creative-name';

// ── Cell model ───────────────────────────────────────────────────────────────

/**
 * One spreadsheet cell. `text` is the displayed value; `link` is the underlying
 * hyperlink URL when the cell is a link (HYPERLINK() formula, UI-inserted cell
 * link, or a rich-text run) — the `LINK DO VIDEO` column uses hyperlinks whose
 * visible text is a label, not the URL, so the URL must come from here.
 */
export interface SheetCell {
  text: string;
  link?: string;
}

type RawCell = SheetCell | string | null | undefined;

function coerce(c: RawCell): SheetCell {
  if (c == null) return { text: '' };
  return typeof c === 'string' ? { text: c } : c;
}

/** The usable link of a cell: its hyperlink if present, else its text (covers
 *  cells where the URL is typed as plain text). */
function cellLink(c: SheetCell): string {
  return (c.link ?? c.text ?? '').trim();
}

// ── Normalization ────────────────────────────────────────────────────────────

/**
 * Match key for a Base Ad Name. Light normalization only (Q4 decision):
 * trim, collapse internal whitespace, case-insensitive. Dots and accents are
 * PRESERVED so "LT129.150" and accented ad names stay intact and distinct.
 */
export function normalizeKey(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Strip accents + the masculine-ordinal sign, lowercase, collapse ws. Used ONLY
 *  for locating header columns (header text is noisier than ad-name values, so we
 *  match it accent-insensitively — e.g. "Nº CRIATIVO", "LINK DO VÍDEO"). */
function normalizeHeader(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining diacritics
    .replace(/[ºª°]/g, '')           // ordinal / degree signs
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** The Base Ad Name of a product = its retailer_id with the trailing date token
 *  stripped (the Product Set is named identically to the retailer_id). */
export function baseAdNameOf(retailerId: string | null | undefined): string {
  if (!retailerId) return '';
  return stripTrailingDateToken(retailerId);
}

// ── Sheet parsing ──────────────────────────────────────────────────────────

/** A parsed, non-blank link row from the NOMECLATURA ADS tab. */
export interface SheetVideoRow {
  baseAdName: string; // raw value from "Nº CRIATIVO" (un-normalized, for display)
  link: string;
  rowNumber: number; // 1-based spreadsheet row, for error messages
}

export interface ParsedSheet {
  rows: SheetVideoRow[];
  /** base names that appeared on >1 row with a link (first non-blank link won). */
  duplicateKeys: string[];
  /** problems that block parsing (missing column, no header row). */
  errors: string[];
}

const HEADER_ROW_INDEX = 4; // row 5 (0-based) — labels live here per the sheet spec
const KEY_HEADER_MATCH = (h: string) => h.includes('criativo');
const LINK_HEADER_MATCH = (h: string) => h.includes('link') && h.includes('video');

/**
 * Parse the raw 2D cell matrix of the NOMECLATURA ADS tab (including the 4
 * preamble rows above the header). Locates the "Nº CRIATIVO" and "LINK DO VÍDEO"
 * columns by header label on row 5, then reads data from row 6 down.
 *
 * Rules (Q9):
 *  - blank link cell → row skipped (not an error).
 *  - duplicate base name → first non-blank link wins; the key is noted in
 *    `duplicateKeys` so the preview can warn.
 */
export function parseNomenclaturaSheet(values: RawCell[][]): ParsedSheet {
  const errors: string[] = [];
  const headerRow = values[HEADER_ROW_INDEX];
  if (!headerRow) {
    return { rows: [], duplicateKeys: [], errors: [`Aba sem linha de cabeçalho na linha 5.`] };
  }

  const normHeader = headerRow.map((c) => normalizeHeader(coerce(c).text));
  const keyCol = normHeader.findIndex(KEY_HEADER_MATCH);
  const linkCol = normHeader.findIndex(LINK_HEADER_MATCH);

  if (keyCol === -1) errors.push('Coluna "Nº CRIATIVO" não encontrada na linha 5.');
  if (linkCol === -1) errors.push('Coluna "LINK DO VIDEO" não encontrada na linha 5.');
  if (errors.length) return { rows: [], duplicateKeys: [], errors };

  const seen = new Map<string, SheetVideoRow>();
  const duplicateKeys = new Set<string>();

  for (let i = HEADER_ROW_INDEX + 1; i < values.length; i++) {
    const row = values[i] ?? [];
    const rawName = coerce(row[keyCol]).text.trim();
    const link = cellLink(coerce(row[linkCol])); // hyperlink URL, or plain-text URL
    if (!rawName || !link) continue; // blank key or blank link → skip

    const key = normalizeKey(rawName);
    const existing = seen.get(key);
    if (existing) {
      // First non-blank link already won; record the collision for the preview.
      duplicateKeys.add(rawName);
      continue;
    }
    seen.set(key, { baseAdName: rawName, link, rowNumber: i + 1 });
  }

  return {
    rows: Array.from(seen.values()),
    duplicateKeys: Array.from(duplicateKeys),
    errors: [],
  };
}

// ── Matching ────────────────────────────────────────────────────────────────

/** A catalog product (missing-video) the import can fill. */
export interface MatchableProduct {
  product_id: string;
  retailer_id: string | null;
  name: string | null;
}

export interface PlannedFill {
  product_id: string;
  retailer_id: string;
  baseAdName: string;
  link: string;
}

export interface VideoImportPlan {
  /** products that matched a sheet link and will be written. */
  toFill: PlannedFill[];
  /** missing-video products whose Base Ad Name had no link in the sheet (the
   *  actionable gap — still need a video). */
  productsWithoutLink: MatchableProduct[];
  /** sheet base names that matched no product in this catalog — low-signal
   *  (the tab is the master list across all catalogs). */
  unmatchedSheetKeys: string[];
  /** duplicate base names in the sheet (first link won). */
  duplicateSheetKeys: string[];
}

/**
 * Build the import plan by matching missing-video products against the parsed
 * sheet. One sheet base name fills EVERY missing-video product sharing it (Q2).
 *
 * @param products  missing-video products only (ignored/already-satisfied are
 *                  excluded upstream by listCatalogProducts).
 */
export function buildVideoImportPlan(
  parsed: ParsedSheet,
  products: MatchableProduct[],
): VideoImportPlan {
  const linkByKey = new Map<string, SheetVideoRow>();
  for (const r of parsed.rows) linkByKey.set(normalizeKey(r.baseAdName), r);

  const toFill: PlannedFill[] = [];
  const productsWithoutLink: MatchableProduct[] = [];
  const matchedKeys = new Set<string>();

  for (const p of products) {
    const key = normalizeKey(baseAdNameOf(p.retailer_id));
    const hit = key ? linkByKey.get(key) : undefined;
    if (hit && p.retailer_id) {
      matchedKeys.add(key);
      toFill.push({
        product_id: p.product_id,
        retailer_id: p.retailer_id,
        baseAdName: hit.baseAdName,
        link: hit.link,
      });
    } else {
      productsWithoutLink.push(p);
    }
  }

  const unmatchedSheetKeys = parsed.rows
    .filter((r) => !matchedKeys.has(normalizeKey(r.baseAdName)))
    .map((r) => r.baseAdName);

  return {
    toFill,
    productsWithoutLink,
    unmatchedSheetKeys,
    duplicateSheetKeys: parsed.duplicateKeys,
  };
}
