import { describe, it, expect } from 'vitest';
import { resolveTheme, normalizeTheme, THEME_STORAGE_KEY } from './theme';

describe('resolveTheme', () => {
  it('returns dark when theme is dark', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('dark', true)).toBe('dark');
  });
  it('returns light when theme is light', () => {
    expect(resolveTheme('light', true)).toBe('light');
  });
  it('follows the OS preference when theme is system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('normalizeTheme', () => {
  it('passes through valid values', () => {
    expect(normalizeTheme('light')).toBe('light');
    expect(normalizeTheme('dark')).toBe('dark');
    expect(normalizeTheme('system')).toBe('system');
  });
  it('falls back to system for invalid/missing values', () => {
    expect(normalizeTheme('purple')).toBe('system');
    expect(normalizeTheme(null)).toBe('system');
    expect(normalizeTheme(undefined)).toBe('system');
  });
});

describe('THEME_STORAGE_KEY', () => {
  it('is the stable localStorage key', () => {
    expect(THEME_STORAGE_KEY).toBe('theme');
  });
});
