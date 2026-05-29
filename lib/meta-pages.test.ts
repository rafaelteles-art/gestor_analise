import { describe, it, expect } from 'vitest';
import { tokensForAccount } from './meta-pages';

describe('tokensForAccount', () => {
  const map = new Map([['P142', 'tokA'], ['106 v2', 'tokB']]);

  it('returns tokens for the accessible profiles, in order', () => {
    expect(tokensForAccount(['P142', '106 v2'], map)).toEqual(['tokA', 'tokB']);
  });
  it('skips profiles with no live token', () => {
    expect(tokensForAccount(['ghost', 'P142'], map)).toEqual(['tokA']);
  });
  it('returns empty when nothing matches', () => {
    expect(tokensForAccount([], map)).toEqual([]);
    expect(tokensForAccount(['ghost'], map)).toEqual([]);
  });
  it('dedupes repeated tokens', () => {
    const m2 = new Map([['a', 'tok'], ['b', 'tok']]);
    expect(tokensForAccount(['a', 'b'], m2)).toEqual(['tok']);
  });
});
