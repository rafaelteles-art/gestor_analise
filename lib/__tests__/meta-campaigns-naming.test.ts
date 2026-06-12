import { describe, it, expect } from 'vitest';
import { dropCriativoToken, substituteDirectAdsVars } from '../meta-campaigns';

/**
 * F7 — {{criativo}} drop rule. When the named entity contains MORE THAN ONE
 * creative, the {{criativo}} token (and its adjacent separators) is stripped
 * BEFORE substitution so shared-entity names never carry dangling separators.
 */
describe('dropCriativoToken', () => {
  it('drops the token plus surrounding separators in the default template', () => {
    expect(
      dropCriativoToken('[{{conta}}] {{orcamento}} {{estrutura}} - {{criativo}} - {{data}}')
    ).toBe('[{{conta}}] {{orcamento}} {{estrutura}} - {{data}}');
  });

  it('drops a token at the START of the template', () => {
    expect(dropCriativoToken('{{criativo}} - Campanha')).toBe('Campanha');
    expect(dropCriativoToken('{{criativo}} Campanha')).toBe('Campanha');
  });

  it('drops a token at the END of the template', () => {
    expect(dropCriativoToken('Campanha - {{criativo}}')).toBe('Campanha');
    expect(dropCriativoToken('Campanha {{criativo}}')).toBe('Campanha');
  });

  it('drops a SOLO token', () => {
    expect(dropCriativoToken('{{criativo}}')).toBe('');
  });

  it('collapses a token separated on BOTH sides into a single separator', () => {
    expect(dropCriativoToken('A - {{criativo}} - B')).toBe('A - B');
    expect(dropCriativoToken('A | {{criativo}} | B')).toBe('A - B');
  });

  it('leaves templates without the token unchanged (modulo space normalisation)', () => {
    expect(dropCriativoToken('[{{conta}}] {{estrutura}} - {{data}}')).toBe(
      '[{{conta}}] {{estrutura}} - {{data}}'
    );
  });

  it('handles em-dash / en-dash / underscore separators', () => {
    expect(dropCriativoToken('A \u2014 {{criativo}} \u2014 B')).toBe('A - B');
    expect(dropCriativoToken('A \u2013 {{criativo}} \u2013 B')).toBe('A - B');
    expect(dropCriativoToken('A_{{criativo}}_B')).toBe('A - B');
  });
});

/**
 * Regression: substituteDirectAdsVars must resolve only OWN properties of the
 * vars lookup. Templates are user-authored, so tokens that name inherited
 * Object.prototype members ({{toString}}, {{constructor}}, {{valueOf}},
 * {{hasOwnProperty}}) must NOT resolve to an inherited Function \u2014 otherwise
 * String(fn) would inject the function source into the resolved name/url_tags.
 * The fix uses Object.prototype.hasOwnProperty.call(lookup, key) instead of
 * `key in lookup`.
 */
describe('substituteDirectAdsVars \u2014 own-property resolution', () => {
  const prototypeTokens = ['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__'];

  for (const token of prototypeTokens) {
    it(`leaves {{${token}}} intact instead of resolving an inherited member`, () => {
      const tpl = `pre {{${token}}} post`;
      const out = substituteDirectAdsVars(tpl, {});
      // Token preserved verbatim \u2014 no function source code injected.
      expect(out).toBe(`pre {{${token}}} post`);
      expect(out).not.toContain('function');
      expect(out).not.toContain('native code');
      expect(out).not.toContain('=>');
    });
  }

  it('still resolves a real own variable', () => {
    expect(substituteDirectAdsVars('[{{conta_nome}}]', { conta_nome: 'ACME' })).toBe('[ACME]');
  });

  it('preserves Meta-native tokens (resolved by Meta at delivery)', () => {
    expect(substituteDirectAdsVars('{{campaign.name}} / {{ad.id}}', {})).toBe(
      '{{campaign.name}} / {{ad.id}}'
    );
  });
});
