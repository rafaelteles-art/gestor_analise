import { describe, it, expect } from 'vitest';
import { defaultCreativeName } from '../creative-name';

describe('defaultCreativeName', () => {
  describe('DPA: strip trailing date token from product set name', () => {
    it('strips "DD/MM" with a space separator', () => {
      expect(defaultCreativeName({ dpa: true, productSetName: 'LT1100.5 06/06' }))
        .toBe('LT1100.5');
    });

    it('strips "- DD/MM" with a dash separator', () => {
      expect(defaultCreativeName({ dpa: true, productSetName: 'LT1100.5 - 06/06' }))
        .toBe('LT1100.5');
    });

    it('strips "DD/MM/YYYY" (4-digit year)', () => {
      expect(defaultCreativeName({ dpa: true, productSetName: 'LT1100.5 06/06/2026' }))
        .toBe('LT1100.5');
    });

    it('strips "DD/MM/YY" (2-digit year)', () => {
      expect(defaultCreativeName({ dpa: true, productSetName: 'LT1100.5 06/06/26' }))
        .toBe('LT1100.5');
    });

    it('strips em-dash and en-dash separators', () => {
      expect(defaultCreativeName({ dpa: true, productSetName: 'LT1100.5 — 06/06' }))
        .toBe('LT1100.5');
      expect(defaultCreativeName({ dpa: true, productSetName: 'LT1100.5 – 06/06' }))
        .toBe('LT1100.5');
    });

    it('leaves a name without a trailing date unchanged', () => {
      expect(defaultCreativeName({ dpa: true, productSetName: 'LT1100.5' }))
        .toBe('LT1100.5');
      expect(defaultCreativeName({ dpa: true, productSetName: 'Kit Verão Premium' }))
        .toBe('Kit Verão Premium');
    });

    it('does not strip a date that is not at the end', () => {
      expect(defaultCreativeName({ dpa: true, productSetName: '06/06 Promo' }))
        .toBe('06/06 Promo');
    });

    it('never returns "" when the set name is entirely a date token', () => {
      // Stripping the whole name leaves nothing — must fall through, not return ''.
      expect(defaultCreativeName({ dpa: true, productSetName: '06/06' }))
        .not.toBe('');
      expect(defaultCreativeName({ dpa: true, productSetName: '06/06' }))
        .toBe('Criativo 1');
      expect(defaultCreativeName({ dpa: true, productSetName: '06/06/2026' }))
        .not.toBe('');
      expect(defaultCreativeName({ dpa: true, productSetName: '06/06/2026' }))
        .toBe('Criativo 1');
    });

    it('falls through to the file name when the set name is entirely a date', () => {
      expect(
        defaultCreativeName({ dpa: true, productSetName: '06/06', fileName: 'promo.mp4' }),
      ).toBe('promo');
    });
  });

  describe('non-DPA / fallback: file name without extension', () => {
    it('strips a single extension', () => {
      expect(defaultCreativeName({ dpa: false, fileName: 'promo-final.mp4' }))
        .toBe('promo-final');
    });

    it('strips extension even when DPA is active but no product set name', () => {
      expect(defaultCreativeName({ dpa: true, fileName: 'video01.mov' }))
        .toBe('video01');
    });

    it('keeps a file name that has no extension', () => {
      expect(defaultCreativeName({ dpa: false, fileName: 'promo-final' }))
        .toBe('promo-final');
    });

    it('never returns "" for a leading-dot file name', () => {
      // ".env" → /\.[^.]+$/ would strip the whole string; must fall through.
      expect(defaultCreativeName({ dpa: false, fileName: '.env' })).not.toBe('');
      expect(defaultCreativeName({ dpa: false, fileName: '.env' })).toBe('Criativo 1');
    });
  });

  describe('last resort', () => {
    it('returns "Criativo 1" when nothing is available', () => {
      expect(defaultCreativeName({ dpa: false })).toBe('Criativo 1');
      expect(defaultCreativeName({ dpa: true })).toBe('Criativo 1');
      expect(defaultCreativeName({ dpa: true, productSetName: '' })).toBe('Criativo 1');
    });
  });
});
