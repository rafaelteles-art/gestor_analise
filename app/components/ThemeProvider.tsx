'use client';

import React, { createContext, useContext, useCallback, useEffect, useState } from 'react';
import {
  type Theme,
  type ResolvedTheme,
  THEME_STORAGE_KEY,
  normalizeTheme,
  resolveTheme,
  applyTheme,
} from '../lib/theme';

type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (t: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Default 'system' on server; corrected from localStorage on mount.
  const [theme, setThemeState] = useState<Theme>('system');
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light');

  // Hydrate from localStorage once on mount.
  useEffect(() => {
    let stored: string | null = null;
    try { stored = localStorage.getItem(THEME_STORAGE_KEY); } catch {}
    const initial = normalizeTheme(stored);
    setThemeState(initial);
    const resolved = resolveTheme(initial, systemPrefersDark());
    setResolvedTheme(resolved);
    applyTheme(resolved);
  }, []);

  // Live-track OS changes only while in 'system' mode.
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const resolved = resolveTheme('system', mq.matches);
      setResolvedTheme(resolved);
      applyTheme(resolved);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch {}
    const resolved = resolveTheme(next, systemPrefersDark());
    setResolvedTheme(resolved);
    applyTheme(resolved);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
