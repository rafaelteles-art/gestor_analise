export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'theme';

/** Coerce any stored/raw value into a valid Theme, defaulting to 'system'. */
export function normalizeTheme(value: unknown): Theme {
  return value === 'light' || value === 'dark' || value === 'system'
    ? value
    : 'system';
}

/** Resolve the effective theme given the user choice and current OS preference. */
export function resolveTheme(theme: Theme, systemPrefersDark: boolean): ResolvedTheme {
  if (theme === 'system') return systemPrefersDark ? 'dark' : 'light';
  return theme;
}

/** Apply a resolved theme to the document root. Safe to call on client only. */
export function applyTheme(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  if (resolved === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');
}
