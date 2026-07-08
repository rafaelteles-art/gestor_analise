import { describe, it, expect } from 'vitest';
import { shouldResetOrphanPixel, pixelSubmitErrors } from '../pixel-guard';

// ─────────────────────────────────────────────────────────────────────────────
// Camada 1 (builder) — spec 2026-07-07-pixel-guard-design.md.
// Bug original: trocar de conta deixava um pixelId da conta anterior no estado;
// o SearchableSelect renderizava vazio mas o submit publicava o ID velho.
// ─────────────────────────────────────────────────────────────────────────────

describe('shouldResetOrphanPixel', () => {
  const base = { pixelId: 'px_A', pixelIds: ['px_B', 'px_C'], loading: false, error: null };

  it('reseta quando a lista carregou sem o pixel selecionado (pixel órfão)', () => {
    expect(shouldResetOrphanPixel(base)).toBe(true);
  });

  it('não reseta enquanto a lista está carregando (lista pode estar stale/vazia)', () => {
    expect(shouldResetOrphanPixel({ ...base, loading: true })).toBe(false);
  });

  it('não reseta sob erro de fetch (lista vazia por falha transitória ≠ sem acesso)', () => {
    expect(shouldResetOrphanPixel({ ...base, error: 'HTTP 502' })).toBe(false);
  });

  it('não reseta quando o pixel pertence à lista', () => {
    expect(shouldResetOrphanPixel({ ...base, pixelIds: ['px_A', 'px_B'] })).toBe(false);
  });

  it('no-op com pixelId vazio', () => {
    expect(shouldResetOrphanPixel({ ...base, pixelId: '' })).toBe(false);
  });

  it('reseta quando a conta não tem pixel nenhum (lista carregada vazia)', () => {
    expect(shouldResetOrphanPixel({ ...base, pixelIds: [] })).toBe(true);
  });
});

describe('pixelSubmitErrors', () => {
  it('engagement não usa pixel — nunca erra', () => {
    expect(pixelSubmitErrors({ isEngagement: true, pixelId: '', pixelIds: [] })).toEqual([]);
  });

  it('vendas sem pixel → "Selecione um pixel." (trava existente, preservada)', () => {
    expect(pixelSubmitErrors({ isEngagement: false, pixelId: '', pixelIds: ['px_B'] }))
      .toEqual(['Selecione um pixel.']);
  });

  it('vendas com pixel fora da lista da conta → erro de pertencimento', () => {
    expect(pixelSubmitErrors({ isEngagement: false, pixelId: 'px_A', pixelIds: ['px_B'] }))
      .toEqual(['O pixel selecionado não pertence a esta conta.']);
  });

  it('vendas com pixel válido → sem erros', () => {
    expect(pixelSubmitErrors({ isEngagement: false, pixelId: 'px_B', pixelIds: ['px_B'] }))
      .toEqual([]);
  });
});
