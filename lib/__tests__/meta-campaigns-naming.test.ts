import { describe, it, expect } from 'vitest';
import { dropCriativoToken } from '../meta-campaigns';

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
