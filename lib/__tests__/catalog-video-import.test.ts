import { describe, it, expect } from 'vitest';
import {
  normalizeKey,
  baseAdNameOf,
  parseNomenclaturaSheet,
  buildVideoImportPlan,
  linkCheckSummary,
  type VideoImportPlan,
} from '../catalog-video-import';

// Checagem de links do builder (docs/adr/0010): resume um plano dry-run em
// "X de Y produtos sem vídeo já têm link" — informa a escolha do hora+N,
// nunca bloqueia o submit.
describe('linkCheckSummary', () => {
  const plan = (toFill: number, withoutLink: number): VideoImportPlan => ({
    toFill: Array.from({ length: toFill }, (_, i) => ({
      product_id: `p${i}`, retailer_id: `LT${i} 01/07`, baseAdName: `LT${i}`, link: `https://v/${i}`,
    })),
    productsWithoutLink: Array.from({ length: withoutLink }, (_, i) => ({
      product_id: `q${i}`, retailer_id: `BD${i} 01/07`, name: null,
    })),
    unmatchedSheetKeys: [],
    duplicateSheetKeys: [],
  });

  it('conta com-link vs. total de produtos sem vídeo', () => {
    expect(linkCheckSummary(plan(42, 8))).toEqual({ with_link: 42, missing_total: 50 });
  });

  it('catálogo sem produtos faltando vídeo → zeros', () => {
    expect(linkCheckSummary(plan(0, 0))).toEqual({ with_link: 0, missing_total: 0 });
  });
});

// Helper: build a raw cell matrix with 4 preamble rows + header on row 5 (index 4).
function sheet(header: string[], ...dataRows: string[][]): string[][] {
  return [[], [], [], [], header, ...dataRows];
}

describe('normalizeKey', () => {
  it('trims, collapses whitespace, lowercases', () => {
    expect(normalizeKey('  LT 1100   x ')).toBe('lt 1100 x');
  });
  it('preserves dots and accents', () => {
    expect(normalizeKey('LT129.150')).toBe('lt129.150');
    expect(normalizeKey('Verão')).toBe('verão');
  });
});

describe('baseAdNameOf', () => {
  it('strips trailing space-separated date (the creation format)', () => {
    expect(baseAdNameOf('LT1100 20/05')).toBe('LT1100');
  });
  it('strips dash-separated and year-bearing dates', () => {
    expect(baseAdNameOf('LT1100.5 - 06/06')).toBe('LT1100.5');
    expect(baseAdNameOf('LT1100.5 — 06/06/26')).toBe('LT1100.5');
  });
  it('leaves a dateless name unchanged', () => {
    expect(baseAdNameOf('LT1100.5')).toBe('LT1100.5');
  });
  it('handles null/empty', () => {
    expect(baseAdNameOf(null)).toBe('');
    expect(baseAdNameOf('')).toBe('');
  });
});

describe('parseNomenclaturaSheet', () => {
  it('locates columns by header label on row 5 and reads from row 6', () => {
    const v = sheet(
      ['Nº CRIATIVO', 'LINK DO VIDEO'],
      ['LT1100', 'https://v/1'],
      ['LT1200', 'https://v/2'],
    );
    const p = parseNomenclaturaSheet(v);
    expect(p.errors).toEqual([]);
    expect(p.rows).toEqual([
      { baseAdName: 'LT1100', link: 'https://v/1', rowNumber: 6 },
      { baseAdName: 'LT1200', link: 'https://v/2', rowNumber: 7 },
    ]);
  });

  it('matches headers accent/ordinal-insensitively and ignores column order', () => {
    const v = sheet(
      ['link do vídeo', 'algo', 'n CRIATIVO'],
      ['https://v/1', 'x', 'LT1100'],
    );
    const p = parseNomenclaturaSheet(v);
    expect(p.errors).toEqual([]);
    expect(p.rows[0]).toMatchObject({ baseAdName: 'LT1100', link: 'https://v/1' });
  });

  it('skips rows with a blank key or blank link', () => {
    const v = sheet(
      ['Nº CRIATIVO', 'LINK DO VIDEO'],
      ['LT1100', ''],       // blank link → skip
      ['', 'https://v/2'],  // blank key → skip
      ['LT1300', 'https://v/3'],
    );
    const p = parseNomenclaturaSheet(v);
    expect(p.rows).toEqual([{ baseAdName: 'LT1300', link: 'https://v/3', rowNumber: 8 }]);
  });

  it('first non-blank link wins on duplicate keys and records the collision', () => {
    const v = sheet(
      ['Nº CRIATIVO', 'LINK DO VIDEO'],
      ['LT1100', 'https://first'],
      ['lt1100 ', 'https://second'], // same key after normalization
    );
    const p = parseNomenclaturaSheet(v);
    expect(p.rows).toEqual([{ baseAdName: 'LT1100', link: 'https://first', rowNumber: 6 }]);
    expect(p.duplicateKeys).toEqual(['lt1100']);
  });

  it('errors when a required column is missing', () => {
    const v = sheet(['Nº CRIATIVO', 'OUTRA'], ['LT1100', 'x']);
    const p = parseNomenclaturaSheet(v);
    expect(p.rows).toEqual([]);
    expect(p.errors.join(' ')).toMatch(/LINK DO VIDEO/);
  });

  it('errors when there is no header row at row 5', () => {
    const p = parseNomenclaturaSheet([[], [], []]);
    expect(p.errors.length).toBeGreaterThan(0);
  });

  it('uses the cell hyperlink (not the visible label) for the link column', () => {
    const v: any[][] = sheet(['Nº CRIATIVO', 'LINK DO VIDEO']);
    v.push(['LT1100', { text: 'ver vídeo', link: 'https://drive/abc' }]);
    const p = parseNomenclaturaSheet(v);
    expect(p.rows).toEqual([{ baseAdName: 'LT1100', link: 'https://drive/abc', rowNumber: 6 }]);
  });

  it('falls back to plain-text URL when a cell has no hyperlink', () => {
    const v: any[][] = sheet(['Nº CRIATIVO', 'LINK DO VIDEO']);
    v.push([{ text: 'LT1200' }, { text: 'https://plain/url' }]);
    const p = parseNomenclaturaSheet(v);
    expect(p.rows[0]).toMatchObject({ baseAdName: 'LT1200', link: 'https://plain/url' });
  });

  it('skips a hyperlink cell whose label is non-empty but link is empty string', () => {
    const v: any[][] = sheet(['Nº CRIATIVO', 'LINK DO VIDEO']);
    v.push([{ text: 'LT1300' }, { text: '', link: '' }]);
    const p = parseNomenclaturaSheet(v);
    expect(p.rows).toEqual([]);
  });

  it('does NOT false-match the "Criativos com empilhamento…" notes column', () => {
    // Reproduces the drifted production sheet: the real creative-ID column (col 1)
    // has a BLANK header, and a long notes column contains the word "criativo".
    const v: any[][] = [
      [], [], [], [],
      ['DATA', '', '', 'LINK DO VIDEO', 'Criativos com empilhamento de hook a serem acompanhados'],
      ['01/05', 'BD1', '', 'https://v/bd1', 'nota'],
    ];
    const p = parseNomenclaturaSheet(v); // no knownBaseNames → no content fallback
    expect(p.rows).toEqual([]);
    expect(p.errors.join(' ')).toMatch(/Nº CRIATIVO/);
  });
});

describe('parseNomenclaturaSheet content fallback', () => {
  // Faithful reproduction of the real NOMECLATURA ADS header row (obs #3000):
  // creative IDs live in col 1 with a BLANK header; "LINK DO VIDEO" is col 7;
  // a "Criativos com empilhamento…" notes column is col 13.
  const driftedHeader = [
    'DATA ENTREGA', '', '', 'EDITOR', 'Nº COPY E DESCRIÇÃO', 'TIPO', 'TESTADO',
    'LINK DO VIDEO', 'LINK COPY', 'CONFERÊNCIA', 'OBS', 'SITUAÇÃO', 'P',
    'Criativos com empilhamento de hook a serem acompanhados',
  ];
  function driftedSheet(): any[][] {
    return [
      [], [], [], [],
      driftedHeader,
      ['01/05', 'BD1', '', 'ana', 'copy', 'ORIGINAL', 'SIM', 'https://v/bd1', '', '', '', '', '', ''],
      ['02/05', 'BD2', '', 'ana', 'copy', 'VARIAÇÃO', 'SIM', 'https://v/bd2', '', '', '', '', '', ''],
    ];
  }

  it('recovers the creative-ID column by matching known Base Ad Names', () => {
    const p = parseNomenclaturaSheet(driftedSheet(), ['BD1', 'BD2', 'BD3']);
    expect(p.errors).toEqual([]);
    expect(p.rows).toEqual([
      { baseAdName: 'BD1', link: 'https://v/bd1', rowNumber: 6 },
      { baseAdName: 'BD2', link: 'https://v/bd2', rowNumber: 7 },
    ]);
  });

  it('errors when the header is absent AND no known names are supplied', () => {
    const p = parseNomenclaturaSheet(driftedSheet()); // no fallback data
    expect(p.rows).toEqual([]);
    expect(p.errors.join(' ')).toMatch(/Nº CRIATIVO/);
  });

  it('errors when known names match no column', () => {
    const p = parseNomenclaturaSheet(driftedSheet(), ['LT9999', 'LT8888']);
    expect(p.rows).toEqual([]);
    expect(p.errors.join(' ')).toMatch(/Nº CRIATIVO/);
  });

  it('prefers the real header over the content fallback when the header is present', () => {
    // Header present in col 0; a decoy col 2 also carries a known name.
    const v: any[][] = [
      [], [], [], [],
      ['Nº CRIATIVO', 'LINK DO VIDEO', 'decoy'],
      ['LT1100', 'https://v/1', 'LT9999'],
    ];
    const p = parseNomenclaturaSheet(v, ['LT1100', 'LT9999']);
    expect(p.rows).toEqual([{ baseAdName: 'LT1100', link: 'https://v/1', rowNumber: 6 }]);
  });

  it('never picks the LINK column even if its URLs happen to match a known name', () => {
    const v: any[][] = [
      [], [], [], [],
      ['DATA', '', 'LINK DO VIDEO'],
      ['01/05', 'BD1', 'https://v/bd1'],
    ];
    const p = parseNomenclaturaSheet(v, ['BD1']);
    expect(p.rows).toEqual([{ baseAdName: 'BD1', link: 'https://v/bd1', rowNumber: 6 }]);
  });
});

describe('buildVideoImportPlan', () => {
  const parsed = parseNomenclaturaSheet(
    sheet(
      ['Nº CRIATIVO', 'LINK DO VIDEO'],
      ['LT1100', 'https://v/1100'],
      ['LT1200', 'https://v/1200'],
      ['LT9999', 'https://v/9999'], // matches no product in catalog
    ),
  );

  it('fills every missing-video product sharing a base name (one base → many dated variants)', () => {
    const plan = buildVideoImportPlan(parsed, [
      { product_id: 'a', retailer_id: 'LT1100 20/05', name: null },
      { product_id: 'b', retailer_id: 'LT1100 21/05', name: null },
    ]);
    expect(plan.toFill.map((f) => f.product_id).sort()).toEqual(['a', 'b']);
    expect(plan.toFill.every((f) => f.link === 'https://v/1100')).toBe(true);
  });

  it('reports products with no matching sheet link as the actionable gap', () => {
    const plan = buildVideoImportPlan(parsed, [
      { product_id: 'a', retailer_id: 'LT1100 20/05', name: null },
      { product_id: 'z', retailer_id: 'LT0000 20/05', name: null },
    ]);
    expect(plan.toFill.map((f) => f.product_id)).toEqual(['a']);
    expect(plan.productsWithoutLink.map((p) => p.product_id)).toEqual(['z']);
  });

  it('reports sheet keys that matched no product as low-signal unmatched', () => {
    const plan = buildVideoImportPlan(parsed, [
      { product_id: 'a', retailer_id: 'LT1100 20/05', name: null },
    ]);
    // LT1200 and LT9999 had links but no matching product
    expect(plan.unmatchedSheetKeys.sort()).toEqual(['LT1200', 'LT9999']);
  });

  it('matches case/space-insensitively against the base ad name', () => {
    const p = parseNomenclaturaSheet(
      sheet(['Nº CRIATIVO', 'LINK DO VIDEO'], ['  lt1100  ', 'https://v/x']),
    );
    const plan = buildVideoImportPlan(p, [
      { product_id: 'a', retailer_id: 'LT1100 20/05', name: null },
    ]);
    expect(plan.toFill).toHaveLength(1);
  });

  it('propagates duplicate sheet keys into the plan', () => {
    const p = parseNomenclaturaSheet(
      sheet(['Nº CRIATIVO', 'LINK DO VIDEO'], ['LT1', 'https://a'], ['LT1', 'https://b']),
    );
    const plan = buildVideoImportPlan(p, []);
    expect(plan.duplicateSheetKeys).toEqual(['LT1']);
  });
});
