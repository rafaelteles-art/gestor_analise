import { describe, it, expect } from 'vitest';
import {
  dropCriativoToken,
  substituteDirectAdsVars,
  contaTokenValue,
  resolveEntityName,
} from '../meta-campaigns';

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

/**
 * F3 + broadcast fix. The {{conta}} token resolves PER JOB on the server (so a
 * multi-account broadcast names each account with its own identity, not the
 * first account's). contaTokenValue encodes the precedence: nickname (apelido)
 * wins over the account name; empty when neither is set.
 */
describe('contaTokenValue', () => {
  it('prefers the nickname (apelido) over the account name', () => {
    expect(contaTokenValue({ conta_apelido: 'Apelido', conta_nome: 'ACME LLC' })).toBe('Apelido');
  });
  it('falls back to the account name when no nickname is set', () => {
    expect(contaTokenValue({ conta_nome: 'ACME LLC' })).toBe('ACME LLC');
    expect(contaTokenValue({ conta_apelido: '', conta_nome: 'ACME LLC' })).toBe('ACME LLC');
  });
  it('is empty when neither is present', () => {
    expect(contaTokenValue({})).toBe('');
  });
});

/**
 * resolveEntityName is the campaign/adset name resolver (lifted out of
 * createCampaignBatch so it is unit-testable). It resolves {{conta}} per job and
 * either substitutes or drops {{criativo}} depending on whether the entity holds
 * one creative (creativeName) or many (null).
 */
describe('resolveEntityName', () => {
  const single = { conta: 'Apelido', multiCreative: false };

  it('resolves {{conta}} per job and {{criativo}} for a single-creative entity', () => {
    expect(
      resolveEntityName('[{{conta}}] {{criativo}}', 'Vídeo 1', '_C01', single)
    ).toBe('[Apelido] Vídeo 1_C01');
  });

  it('drops {{criativo}} (and adjacent separators) for a shared multi-creative entity', () => {
    // creativeName === null => entity shared by several creatives.
    expect(
      resolveEntityName('[{{conta}}] {{estrutura}} - {{criativo}}', null, '_C01', {
        conta: 'Apelido',
        multiCreative: true,
      })
    ).toBe('[Apelido] {{estrutura}}_C01');
  });

  it('appends " — <criativo>" when there are several creatives but the template lacks the token', () => {
    expect(
      resolveEntityName('[{{conta}}] Campanha', 'Vídeo 2', '_CJ01', {
        conta: 'Apelido',
        multiCreative: true,
      })
    ).toBe('[Apelido] Campanha — Vídeo 2_CJ01');
  });

  it('leaves the name without a stray {{conta}} when conta is empty', () => {
    expect(resolveEntityName('[{{conta}}] X', 'cr', '', { conta: '', multiCreative: false })).toBe('[] X');
  });
});
