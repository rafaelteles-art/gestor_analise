import { describe, it, expect } from 'vitest';
import {
  singleGroup,
  normalizeGroups,
  moveToGroup,
  renameGroup,
  toCreativeGroupsPayload,
  parseCreativeGroupsTable,
  groupsStateFromRows,
  draftIdsInGroups,
  parseProductSetList,
  type CreativeGroupsState,
} from '../creative-groups';

// Estado client-side dos Creative Groups (ADR-0009): nomes de coluna +
// atribuição draftId→grupo. Sempre compactado (0..K-1, sem grupos vazios).

describe('singleGroup', () => {
  it('puts every draft in Grupo 1', () => {
    const s = singleGroup(['a', 'b']);
    expect(s.names).toEqual(['Grupo 1']);
    expect(s.byId).toEqual({ a: 0, b: 0 });
  });
});

describe('normalizeGroups', () => {
  it('assigns missing drafts to group 0 and drops stale ids', () => {
    const s: CreativeGroupsState = { names: ['Hooks', 'Depo'], byId: { a: 1, zumbi: 0 } };
    const n = normalizeGroups(s, ['a', 'novo']);
    expect(n.byId).toEqual({ a: 1, novo: 0 });
    expect(n.names).toEqual(['Hooks', 'Depo']);
  });

  it('compacts away empty groups, preserving surviving names in order', () => {
    // grupo 1 (Depo) ficou vazio após remoção do draft
    const s: CreativeGroupsState = { names: ['Hooks', 'Depo', 'UGC'], byId: { a: 0, c: 2 } };
    const n = normalizeGroups(s, ['a', 'c']);
    expect(n.names).toEqual(['Hooks', 'UGC']);
    expect(n.byId).toEqual({ a: 0, c: 1 });
  });

  it('resets to a single Grupo 1 when there are no drafts', () => {
    const s: CreativeGroupsState = { names: ['Hooks', 'Depo'], byId: {} };
    expect(normalizeGroups(s, [])).toEqual({ names: ['Grupo 1'], byId: {} });
  });

  it('preserves an empty-string name while the user is editing (fallback is display/server-side)', () => {
    const s: CreativeGroupsState = { names: ['', 'Depo'], byId: { a: 0, b: 1 } };
    const n = normalizeGroups(s, ['a', 'b']);
    expect(n.names).toEqual(['', 'Depo']);
  });

  it('pads names for out-of-range assignments instead of crashing', () => {
    const s: CreativeGroupsState = { names: ['Hooks'], byId: { a: 0, b: 3 } };
    const n = normalizeGroups(s, ['a', 'b']);
    // b: grupo 3 sem nome → vira 2º grupo compactado com fallback
    expect(n.names).toEqual(['Hooks', 'Grupo 4']);
    expect(n.byId).toEqual({ a: 0, b: 1 });
  });
});

describe('moveToGroup', () => {
  const base: CreativeGroupsState = { names: ['Hooks', 'Depo'], byId: { a: 0, b: 0, c: 1 } };

  it('moves a draft to an existing group', () => {
    const n = moveToGroup(base, ['a', 'b', 'c'], 'b', 1);
    expect(n.byId).toEqual({ a: 0, b: 1, c: 1 });
    expect(n.names).toEqual(['Hooks', 'Depo']);
  });

  it('creates a new group when target === names.length', () => {
    const n = moveToGroup(base, ['a', 'b', 'c'], 'b', 2);
    expect(n.names).toEqual(['Hooks', 'Depo', 'Grupo 3']);
    expect(n.byId.b).toBe(2);
  });

  it('vanishes the source group when its last draft leaves (auto-compact)', () => {
    const n = moveToGroup(base, ['a', 'b', 'c'], 'c', 0);
    expect(n.names).toEqual(['Hooks']);
    expect(n.byId).toEqual({ a: 0, b: 0, c: 0 });
  });
});

describe('renameGroup', () => {
  it('renames a column without touching assignments', () => {
    const s: CreativeGroupsState = { names: ['Grupo 1', 'Grupo 2'], byId: { a: 0, b: 1 } };
    const n = renameGroup(s, 1, 'Depoimentos');
    expect(n.names).toEqual(['Grupo 1', 'Depoimentos']);
    expect(n.byId).toEqual(s.byId);
  });
});

describe('toCreativeGroupsPayload', () => {
  it('emits assignments in the given creatives order', () => {
    const s: CreativeGroupsState = { names: ['Hooks', 'Depo'], byId: { a: 0, b: 1, c: 0 } };
    expect(toCreativeGroupsPayload(s, ['c', 'a', 'b'])).toEqual({
      names: ['Hooks', 'Depo'],
      assignments: [0, 0, 1],
    });
  });
});

// Import em massa: colar tabela "Conjunto \t Anúncio \t ID do conjunto de
// produtos" (Sheets/Excel) e materializar drafts DPA já agrupados.

describe('parseCreativeGroupsTable', () => {
  it('parses TSV rows and skips the header line', () => {
    const text = [
      'Conjunto\tAnuncio\tID do conjunto de produtos',
      'RM01\tBDM01\t1018724193904597',
      'RM01\tBDM02\t1318730223804323',
      'RM02\tBDM05\t2184351375689863',
    ].join('\n');
    const { rows, errors } = parseCreativeGroupsTable(text);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { group: 'RM01', name: 'BDM01', productSetId: '1018724193904597' },
      { group: 'RM01', name: 'BDM02', productSetId: '1318730223804323' },
      { group: 'RM02', name: 'BDM05', productSetId: '2184351375689863' },
    ]);
  });

  it('accepts whitespace-separated rows and ignores blank lines', () => {
    const text = 'RM01  BDM01  1018724193904597\n\n  \nRC02 BDM13 1369079581821289\n';
    const { rows, errors } = parseCreativeGroupsTable(text);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({ group: 'RC02', name: 'BDM13', productSetId: '1369079581821289' });
  });

  it('reports invalid lines with their number and keeps valid ones', () => {
    const text = 'RM01\tBDM01\t1018724193904597\nRM01\tBDM02\tnão-é-id\nsó-duas\tcolunas';
    const { rows, errors } = parseCreativeGroupsTable(text);
    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('Linha 2');
    expect(errors[1]).toContain('Linha 3');
  });

  it('handles dotted ad names like BM31.1', () => {
    const { rows, errors } = parseCreativeGroupsTable('LC01\tBM31.1\t999574386189761');
    expect(errors).toEqual([]);
    expect(rows[0]).toEqual({ group: 'LC01', name: 'BM31.1', productSetId: '999574386189761' });
  });
});

describe('groupsStateFromRows', () => {
  it('builds names in first-appearance order and maps draft ids to group idx', () => {
    const rows = [
      { group: 'RM01', name: 'BDM01', productSetId: '1' },
      { group: 'RM02', name: 'BDM05', productSetId: '2' },
      { group: 'RM01', name: 'BDM02', productSetId: '3' },
    ];
    const s = groupsStateFromRows(rows, ['a', 'b', 'c']);
    expect(s.names).toEqual(['RM01', 'RM02']);
    expect(s.byId).toEqual({ a: 0, b: 1, c: 0 });
  });
});

describe('draftIdsInGroups', () => {
  it('returns draft ids assigned to any of the given group indices', () => {
    const s: CreativeGroupsState = { names: ['A', 'B', 'C'], byId: { a: 0, b: 1, c: 1, d: 2 } };
    expect(draftIdsInGroups(s, [1]).sort()).toEqual(['b', 'c']);
    expect(draftIdsInGroups(s, [0, 2]).sort()).toEqual(['a', 'd']);
  });

  it('returns an empty array when no groups are selected', () => {
    const s: CreativeGroupsState = { names: ['A'], byId: { a: 0 } };
    expect(draftIdsInGroups(s, [])).toEqual([]);
  });

  it('ignores group indices that do not exist', () => {
    const s: CreativeGroupsState = { names: ['A'], byId: { a: 0 } };
    expect(draftIdsInGroups(s, [5])).toEqual([]);
  });
});

describe('parseProductSetList', () => {
  it('parses one product set id per line', () => {
    const { ids, errors, duplicates } = parseProductSetList('1018724193904597\n1318730223804323');
    expect(errors).toEqual([]);
    expect(duplicates).toEqual([]);
    expect(ids).toEqual(['1018724193904597', '1318730223804323']);
  });

  it('ignores blank lines and surrounding whitespace', () => {
    const { ids, errors } = parseProductSetList('  1018724193904597  \n\n   \n1318730223804323\n');
    expect(errors).toEqual([]);
    expect(ids).toEqual(['1018724193904597', '1318730223804323']);
  });

  it('takes the last cell when extra columns are pasted (tolerant)', () => {
    const { ids, errors } = parseProductSetList('LT100\t1018724193904597\nLT200\t1318730223804323');
    expect(errors).toEqual([]);
    expect(ids).toEqual(['1018724193904597', '1318730223804323']);
  });

  it('skips a leading header row silently', () => {
    const { ids, errors } = parseProductSetList('ID do conjunto de produtos\n1018724193904597');
    expect(errors).toEqual([]);
    expect(ids).toEqual(['1018724193904597']);
  });

  it('reports non-id lines after the first with their line number and keeps valid ones', () => {
    const { ids, errors } = parseProductSetList('1018724193904597\nnão-é-id\n1318730223804323');
    expect(ids).toEqual(['1018724193904597', '1318730223804323']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Linha 2');
  });

  it('keeps duplicates as separate creatives but lists each repeated id once', () => {
    const { ids, duplicates } = parseProductSetList('1018724193904597\n1018724193904597\n1318730223804323');
    expect(ids).toEqual(['1018724193904597', '1018724193904597', '1318730223804323']);
    expect(duplicates).toEqual(['1018724193904597']);
  });

  it('returns empty for empty text', () => {
    expect(parseProductSetList('')).toEqual({ ids: [], errors: [], duplicates: [] });
  });
});
