/**
 * Unit tests for the filterOptions and groupOptions pure functions exported
 * from app/components/SearchableSelect.tsx.
 *
 * Coverage:
 *  - accent-insensitive match  ('publico' matches 'Público 1%')
 *  - sublabel match            (account id substring)
 *  - group order preservation  (via groupOptions, the actual grouping logic)
 *  - empty query returns all options unchanged
 */

import { describe, it, expect } from 'vitest';
import { filterOptions, groupOptions } from '../../app/components/SearchableSelect';
import type { SSOption } from '../../app/components/SearchableSelect';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const AUDIENCES: SSOption[] = [
  { value: 'a1', label: 'Público 1%', sublabel: '987654321', group: 'Salvo' },
  { value: 'a2', label: 'Público 1%', sublabel: '123456789', group: 'Salvo' },  // duplicate label, different account
  { value: 'a3', label: 'Lookalike BR 1%', sublabel: '111111111', group: 'Lookalike' },
  { value: 'a4', label: 'Remarketing 30d', sublabel: '222222222', group: 'Salvo' },
];

// ─── filterOptions tests ──────────────────────────────────────────────────────

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

// ─── groupOptions tests ───────────────────────────────────────────────────────
//
// These tests exercise the actual grouping logic (groupOptions), which the
// React component's useMemos delegate to. A test that only called
// filterOptions('') cannot reach this path because the empty-query early-return
// skips all filtering and returns the original array unchanged.

describe('groupOptions', () => {
  it('groups appear in first-occurrence order (Salvo before Lookalike)', () => {
    // AUDIENCES order: a1 Salvo, a2 Salvo, a3 Lookalike, a4 Salvo
    // First occurrence: Salvo at index 0, Lookalike at index 2
    const groups = groupOptions(AUDIENCES);
    expect(groups.map(g => g.group)).toEqual(['Salvo', 'Lookalike']);
  });

  it('items within each group are in original array order', () => {
    const groups = groupOptions(AUDIENCES);
    const salvo = groups.find(g => g.group === 'Salvo')!;
    const lookalike = groups.find(g => g.group === 'Lookalike')!;
    expect(salvo.items.map(o => o.value)).toEqual(['a1', 'a2', 'a4']);
    expect(lookalike.items.map(o => o.value)).toEqual(['a3']);
  });

  it('group order is determined by first occurrence, not alphabetical', () => {
    // Explicitly construct an array where alphabetical order differs from first-occurrence order
    const options: SSOption[] = [
      { value: 'z1', label: 'Zebra', group: 'Zoo' },
      { value: 'a1', label: 'Ant', group: 'Animals' },
      { value: 'z2', label: 'Zebu', group: 'Zoo' },
    ];
    const groups = groupOptions(options);
    // Zoo appears first in the array, so it must be first in the result
    expect(groups.map(g => g.group)).toEqual(['Zoo', 'Animals']);
  });

  it('options without a group key are collected under the empty-string sentinel', () => {
    const options: SSOption[] = [
      { value: 'x', label: 'São Paulo' },
      { value: 'y', label: 'Rio de Janeiro' },
    ];
    const groups = groupOptions(options);
    expect(groups).toHaveLength(1);
    expect(groups[0].group).toBe('');
    expect(groups[0].items.map(o => o.value)).toEqual(['x', 'y']);
  });

  it('mixed grouped and ungrouped options: ungrouped sentinel preserves first-occurrence position', () => {
    const options: SSOption[] = [
      { value: 'u1', label: 'Ungrouped first' },
      { value: 'g1', label: 'Grouped', group: 'G' },
      { value: 'u2', label: 'Ungrouped second' },
    ];
    const groups = groupOptions(options);
    // '' appears at index 0, 'G' at index 1
    expect(groups.map(gd => gd.group)).toEqual(['', 'G']);
    expect(groups[0].items.map(o => o.value)).toEqual(['u1', 'u2']);
    expect(groups[1].items.map(o => o.value)).toEqual(['g1']);
  });

  it('empty input returns empty array', () => {
    expect(groupOptions([])).toEqual([]);
  });

  it('group order is preserved after filterOptions narrows the set', () => {
    // After filtering by 'lookalike', only a3 (Lookalike group) survives.
    // groupOptions should return a single group.
    const filtered = filterOptions(AUDIENCES, 'lookalike');
    const groups = groupOptions(filtered);
    expect(groups.map(g => g.group)).toEqual(['Lookalike']);
    expect(groups[0].items.map(o => o.value)).toEqual(['a3']);
  });

  it('combined filter+group: "1%" matches a1, a2, a3 — Salvo group precedes Lookalike', () => {
    // a1 Salvo, a2 Salvo, a3 Lookalike all match "1%"; a4 (Remarketing 30d) does not
    const filtered = filterOptions(AUDIENCES, '1%');
    const groups = groupOptions(filtered);
    expect(groups.map(g => g.group)).toEqual(['Salvo', 'Lookalike']);
    expect(groups[0].items.map(o => o.value)).toEqual(['a1', 'a2']);
    expect(groups[1].items.map(o => o.value)).toEqual(['a3']);
  });
});
