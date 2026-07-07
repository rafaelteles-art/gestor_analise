'use client';

import {
  useCallback, useEffect, useRef, useState,
  type DependencyList, type Dispatch, type SetStateAction,
} from 'react';

/**
 * Recurso recarregável do builder: auto-carrega quando `deps` mudam (com
 * `enabled`), e expõe `refresh()` para o botão ↻ recarregar só esta fonte sem
 * reload da página. Latest-wins: resposta de um load antigo que chegar
 * atrasada é descartada (contador de request).
 *
 * - `enabled: false` → reseta `data` para `initial` e não busca (semântica de
 *   product sets sem catálogo selecionado).
 * - `auto: false` → nunca auto-carrega; só via `refresh()` (caso das BMs).
 * - `initial` é capturado no primeiro render (mudanças posteriores são ignoradas).
 */
export interface Refreshable<T> {
  data: T;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<T | null>;
  reset: () => void;
  setData: Dispatch<SetStateAction<T>>;
}

export function useRefreshable<T>(opts: {
  fetcher: () => Promise<T>;
  initial: T;
  deps: DependencyList;
  enabled?: boolean;
  auto?: boolean;
}): Refreshable<T> {
  const { fetcher, deps, enabled = true, auto = true } = opts;
  const [data, setData] = useState<T>(opts.initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reqIdRef = useRef(0);
  const initialRef = useRef(opts.initial);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher; // sempre a closure mais recente; `deps` dirigem o auto-load
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const refresh = useCallback(async (): Promise<T | null> => {
    if (!enabledRef.current) return null;
    const id = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetcherRef.current();
      if (id !== reqIdRef.current) return null; // resposta velha: descarta
      setData(result);
      return result;
    } catch (e) {
      if (id !== reqIdRef.current) return null;
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      if (id === reqIdRef.current) setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    reqIdRef.current++; // invalida qualquer request em voo
    setData(initialRef.current);
    setLoading(false);
    setError(null);
  }, []);

  useEffect(() => {
    if (!enabled) { reset(); return; }
    if (!auto) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, auto]);

  return { data, loading, error, refresh, reset, setData };
}

/** fetch + json com contrato de erro das rotas do builder ({ error: string }). */
export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const data: unknown = await res.json().catch(() => ({}));
  const err = (data as { error?: unknown })?.error;
  if (!res.ok || err) throw new Error(typeof err === 'string' ? err : `HTTP ${res.status}`);
  return data as T;
}
