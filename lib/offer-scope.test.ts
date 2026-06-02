import { describe, it, expect } from 'vitest';
import { parseOfertaParam } from './offer-scope';

describe('parseOfertaParam', () => {
  it('treats absent / empty / "todas" as union (null)', () => {
    expect(parseOfertaParam(null)).toBeNull();
    expect(parseOfertaParam(undefined)).toBeNull();
    expect(parseOfertaParam('')).toBeNull();
    expect(parseOfertaParam('todas')).toBeNull();
  });
  it('parses a positive integer id', () => {
    expect(parseOfertaParam('5')).toBe(5);
  });
  it('rejects non-positive / non-numeric', () => {
    expect(parseOfertaParam('0')).toBeNull();
    expect(parseOfertaParam('-3')).toBeNull();
    expect(parseOfertaParam('abc')).toBeNull();
    expect(parseOfertaParam('1.5')).toBeNull();
  });
  it('takes the first value if given an array', () => {
    expect(parseOfertaParam(['7', '8'])).toBe(7);
  });
});
