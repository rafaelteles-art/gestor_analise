/**
 * Unit tests for the filterOptions pure function exported from
 * app/components/SearchableSelect.tsx.
 *
 * Coverage:
 *  - accent-insensitive match  ('publico' matches 'Público 1%')
 *  - sublabel match            (account id substring)
 *  - group order preservation
 *  - empty query returns all options unchanged
 */

import { describe, it, expect } from 'vitest';
import { filterOptions } from '../../app/components/SearchableSelect';
import type { SSOption } from '../../app/components/SearchableSelect';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const AUDIENCES: SSOption[] = [
  { value: 'a1', label: 'Público 1%', sublabel: '987654321', group: 'Salvo' },
  { value: 'a2', label: 'Público 1%', sublabel: '123456789', group: 'Salvo' },  // duplicate label, different account
  { value: 'a3', label: 'Lookalike BR 1%', sublabel: '111111111', group: 'Lookalike' },
  { value: 'a4', label: 'Remarketing 30d', sublabel: '222222222', group: 'Salvo' },
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('filterOptions', () => {
  it('empty query returns all options unchanged (same reference order)', () => {
    const result = filterOptions(AUDIENCES, '');
    expect(result).toEqual(AUDIENCES);
    // Same array identity (no filtering performed)
    expect(result).toBe(AUDIENCES);
  });

  it('whitespace-only query returns all options', () => {
    const result = filterOptions(AUDIENCES, '   ');
    expect(result).toBe(AUDIENCES);
  });

  it('accent-insensitive: "publico" matches "Público 1%"', () => {
    const result = filterOptions(AUDIENCES, 'publico');
    expect(result.map(o => o.value)).toEqual(['a1', 'a2']);
  });

  it('accent-insensitive: "Público 1%" (with accent) also matches', () => {
    const result = filterOptions(AUDIENCES, 'Público 1%');
    expect(result.map(o => o.value)).toEqual(['a1', 'a2']);
  });

  it('case-insensitive: "PUBLICO" matches "Público 1%"', () => {
    const result = filterOptions(AUDIENCES, 'PUBLICO');
    expect(result.map(o => o.value)).toEqual(['a1', 'a2']);
  });

  it('sublabel match: account id substring "987654" matches first audience', () => {
    const result = filterOptions(AUDIENCES, '987654');
    expect(result.map(o => o.value)).toEqual(['a1']);
  });

  it('sublabel match: "123456" matches second audience', () => {
    const result = filterOptions(AUDIENCES, '123456');
    expect(result.map(o => o.value)).toEqual(['a2']);
  });

  it('group order preservation: groups appear in first-occurrence order', () => {
    // All options returned — verify the order is Salvo items first, then Lookalike
    const result = filterOptions(AUDIENCES, '');
    const groups = result.map(o => o.group);
    // Salvo comes first (a1, a2, a4), then Lookalike (a3)
    expect(groups).toEqual(['Salvo', 'Salvo', 'Lookalike', 'Salvo']);
  });

  it('group order preservation with a narrowing query: surviving groups preserve original order', () => {
    // 'lookalike' only matches a3 (group Lookalike) and also 'Lookalike BR 1%' label
    const result = filterOptions(AUDIENCES, 'lookalike');
    expect(result.map(o => o.value)).toEqual(['a3']);
    expect(result[0].group).toBe('Lookalike');
  });

  it('no match returns empty array', () => {
    const result = filterOptions(AUDIENCES, 'xyzxyzxyz_nomatch');
    expect(result).toEqual([]);
  });

  it('matches partial label substring', () => {
    const result = filterOptions(AUDIENCES, 'remarket');
    expect(result.map(o => o.value)).toEqual(['a4']);
  });

  it('options without group or sublabel still match on label', () => {
    const simple: SSOption[] = [
      { value: 'x', label: 'São Paulo' },
      { value: 'y', label: 'Rio de Janeiro' },
    ];
    const result = filterOptions(simple, 'sao paulo');
    expect(result.map(o => o.value)).toEqual(['x']);
  });

  it('accent-insensitive: "sao paulo" matches "São Paulo"', () => {
    const simple: SSOption[] = [
      { value: 'x', label: 'São Paulo' },
      { value: 'y', label: 'Rio de Janeiro' },
    ];
    const result = filterOptions(simple, 'sao paulo');
    expect(result.map(o => o.value)).toEqual(['x']);
  });
});
