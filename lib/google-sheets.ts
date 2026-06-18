// Google Sheets read — reuses the app-wide Drive OAuth (lib/google-drive.ts).
//
// The Sheets API `spreadsheets.values.get` read methods accept the
// `https://www.googleapis.com/auth/drive.readonly` scope, which the app already
// holds — so reading a sheet needs NO new scope and NO re-consent (see
// docs/adr/0006). If Google ever rejects that scope here, the surfaced error is
// explicit so we can fall back to a Drive CSV export of the tab.

import { getAccessToken, invalidateAccessTokenCache, DriveAuthError, DriveHttpError } from './google-drive';
import type { SheetCell } from './catalog-video-import';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

// Grid fields we need: displayed value + every place a hyperlink can hide.
//  - hyperlink            → UI-inserted whole-cell link
//  - textFormatRuns.link  → rich-text partial links
//  - userEnteredValue     → formulaValue carries =HYPERLINK("url",…)
const GRID_FIELDS =
  'sheets(data(rowData(values(formattedValue,hyperlink,userEnteredValue,effectiveValue,textFormatRuns))))';

/** Pull the underlying URL out of a CellData, checking each place a link lives. */
function extractCellLink(c: any): string | undefined {
  if (typeof c?.hyperlink === 'string' && c.hyperlink) return c.hyperlink;
  if (Array.isArray(c?.textFormatRuns)) {
    const run = c.textFormatRuns.find((r: any) => r?.format?.link?.uri);
    if (run) return run.format.link.uri as string;
  }
  const formula = c?.userEnteredValue?.formulaValue;
  if (typeof formula === 'string') {
    // =HYPERLINK("https://…","label")  — first quoted arg is the URL.
    const m = formula.match(/=\s*HYPERLINK\(\s*"((?:[^"\\]|\\.)*)"/i);
    if (m) return m[1];
  }
  return undefined;
}

function extractCellText(c: any): string {
  const v =
    c?.formattedValue ??
    c?.userEnteredValue?.stringValue ??
    c?.effectiveValue?.stringValue ??
    c?.userEnteredValue?.numberValue ??
    c?.effectiveValue?.numberValue ??
    '';
  return String(v);
}

/**
 * Read every cell of a single named tab as a 2D matrix of {text, link} cells
 * (row-major, including preamble rows above the header). Uses spreadsheets.get
 * with grid data so HYPERLINK cells yield their URL, not just the label.
 * Trailing empty rows/cells are omitted by the API — rows are ragged, callers
 * must tolerate gaps (parseNomenclaturaSheet does).
 *
 * @param spreadsheetId  Drive file id of the spreadsheet (from the Picker).
 * @param tabName        sheet/tab title, e.g. "NOMECLATURA ADS".
 */
export async function readSheetTabCells(spreadsheetId: string, tabName: string): Promise<SheetCell[][]> {
  // Range = just the (quoted) tab title → whole used grid. Double embedded quotes.
  const a1 = `'${tabName.replace(/'/g, "''")}'`;
  const url =
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}` +
    `?ranges=${encodeURIComponent(a1)}&includeGridData=true&fields=${encodeURIComponent(GRID_FIELDS)}`;

  // Mirror the drive lib's single 401-retry-on-fresh-token pattern.
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getAccessToken();
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      if (res.status === 401) {
        invalidateAccessTokenCache();
        if (attempt === 0) continue;
        throw new DriveAuthError(`Sem acesso à planilha do Google: ${text}`);
      }
      if (res.status === 403) {
        const isRateLimit = /userRateLimitExceeded|rateLimitExceeded|RESOURCE_EXHAUSTED/.test(text);
        if (isRateLimit) throw new DriveHttpError(429, `Sheets quota exceeded (retry later): ${text}`);
        throw new DriveAuthError(`Sem acesso à planilha do Google: ${text}`);
      }
      if (res.status === 404) {
        throw new SheetReadError(
          `Aba "${tabName}" ou planilha não encontrada. Confirme que o arquivo é uma Planilha Google (não .xlsx) e que a aba existe.`,
        );
      }
      throw new DriveHttpError(res.status, `Sheets API error ${res.status}: ${text}`);
    }

    const json = await res.json();
    const rowData = json?.sheets?.[0]?.data?.[0]?.rowData;
    if (!Array.isArray(rowData)) return [];
    return rowData.map((row: any) => {
      const cells = row?.values;
      if (!Array.isArray(cells)) return [];
      return cells.map((c: any): SheetCell => ({ text: extractCellText(c).trim(), link: extractCellLink(c) }));
    });
  }

  throw new DriveAuthError('Sem acesso à planilha do Google');
}

export class SheetReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SheetReadError';
  }
}
