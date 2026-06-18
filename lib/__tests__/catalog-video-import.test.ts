import { describe, it, expect } from 'vitest';
import {
  normalizeKey,
  baseAdNameOf,
  parseNomenclaturaSheet,
  buildVideoImportPlan,
} from '../catalog-video-import';

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
