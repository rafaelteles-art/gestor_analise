'use client';

import React, { useMemo, useState } from 'react';

interface CatalogEntry {
  id: string;
  name: string;
  product_count: number | null;
  vertical: string | null;
  relationship: 'owned' | 'client';
}

interface BMWithCatalogs {
  bm_id: string;
  bm_name: string;
  accessible_profiles: string[];
  catalogs: CatalogEntry[];
}

interface CatalogEndpointAttempt {
  endpoint: 'owned' | 'client';
  status: 'ok' | 'empty' | 'error';
  count: number;
  error_code: number | string | null;
  error_message: string | null;
}

interface CatalogTokenAttempt {
  profile_name: string;
  token_preview: string;
  endpoints: CatalogEndpointAttempt[];
}

interface BMDiagnostic {
  bm_id: string;
  bm_name: string;
  total_catalogs: number;
  attempts: CatalogTokenAttempt[];
}

const formatNumber = (v: number) => v.toLocaleString('pt-BR');

export default function ClientCatalogo({ initialGroups }: { initialGroups: BMWithCatalogs[] }) {
  const [groups, setGroups] = useState<BMWithCatalogs[]>(initialGroups);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(initialGroups.filter((g) => g.catalogs.length > 0).map((g) => g.bm_id))
  );
  const [diagnostics, setDiagnostics] = useState<BMDiagnostic[] | null>(null);
  const [diagOpen, setDiagOpen] = useState(false);
  const [diagFilter, setDiagFilter] = useState<'all' | 'empty' | 'errors'>('all');

  const reloadFromDB = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/catalogs');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      const list: BMWithCatalogs[] = data.groups ?? [];
      setGroups(list);
      setExpanded(new Set(list.filter((g) => g.catalogs.length > 0).map((g) => g.bm_id)));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    if (!window.confirm('Sincronizar catálogos com a Meta? Isso pode levar alguns minutos dependendo da quantidade de BMs.')) return;
    setSyncing(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch('/api/catalogs/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      const list: BMWithCatalogs[] = data.groups ?? [];
      setGroups(list);
      setExpanded(new Set(list.filter((g) => g.catalogs.length > 0).map((g) => g.bm_id)));
      setDiagnostics(Array.isArray(data.diagnostics) ? data.diagnostics : null);
      setDiagOpen(true);
      setInfo(`${data.count} catálogos sincronizados em ${list.length} BMs.`);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSyncing(false);
    }
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return groups;
    const q = search.toLowerCase();
    return groups
      .map((g) => {
        const bmHit = g.bm_name.toLowerCase().includes(q) || g.bm_id.includes(q);
        const catalogs = bmHit
          ? g.catalogs
          : g.catalogs.filter(
              (c) => c.name.toLowerCase().includes(q) || c.id.includes(q)
            );
        if (!bmHit && catalogs.length === 0) return null;
        return { ...g, catalogs };
      })
      .filter(Boolean) as BMWithCatalogs[];
  }, [groups, search]);

  const totals = useMemo(() => {
    const totalCatalogs = groups.reduce((s, g) => s + g.catalogs.length, 0);
    const totalProducts = groups.reduce(
      (s, g) => s + g.catalogs.reduce((sc, c) => sc + (c.product_count ?? 0), 0),
      0
    );
    return { bms: groups.length, catalogs: totalCatalogs, products: totalProducts };
  }, [groups]);

  const toggle = (bmId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(bmId)) next.delete(bmId); else next.add(bmId);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header / actions */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-bold text-gray-900">Catálogos do Facebook</h1>
            <p className="text-xs text-gray-500">
              {syncing
                ? 'Sincronizando com a Meta…'
                : loading
                ? 'Lendo do banco…'
                : `${totals.bms} BMs · ${totals.catalogs} catálogos · ${formatNumber(totals.products)} produtos`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Filtrar BM ou catálogo..."
              className="pl-9 pr-4 py-1.5 border border-gray-200 rounded-md text-xs w-64 outline-none focus:border-indigo-500 bg-gray-50"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            onClick={reloadFromDB}
            disabled={loading || syncing}
            title="Recarregar do banco de dados"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-indigo-300 hover:text-indigo-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {loading ? 'Lendo...' : 'Recarregar'}
          </button>
          <button
            onClick={handleSync}
            disabled={loading || syncing}
            title="Buscar catálogos diretamente da Meta e atualizar o banco"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-emerald-200 text-emerald-600 hover:bg-emerald-50 hover:border-emerald-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m8.66-13l-.87.5M4.21 15.5l-.87.5M20.66 15.5l-.87-.5M4.21 8.5l-.87-.5M21 12h-1M4 12H3" />
              <circle cx="12" cy="12" r="4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {syncing ? 'Sincronizando...' : 'Sincronizar Meta'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 text-sm">
          {error}
        </div>
      )}
      {info && !error && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl p-3 text-xs">
          {info}
        </div>
      )}

      {diagnostics && diagnostics.length > 0 && (() => {
        const withCatalogs   = diagnostics.filter((d) => d.total_catalogs > 0).length;
        const withoutAny     = diagnostics.filter((d) => d.total_catalogs === 0).length;
        const withAnyError   = diagnostics.filter((d) =>
          d.attempts.some((a) => a.endpoints.some((e) => e.status === 'error'))
        ).length;

        const filtered = diagnostics.filter((d) => {
          if (diagFilter === 'all') return true;
          if (diagFilter === 'empty') return d.total_catalogs === 0;
          if (diagFilter === 'errors')
            return d.attempts.some((a) => a.endpoints.some((e) => e.status === 'error'));
          return true;
        });

        return (
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <button
              onClick={() => setDiagOpen((v) => !v)}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <svg className={`w-4 h-4 text-gray-500 transition-transform ${diagOpen ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
                <div>
                  <div className="text-sm font-bold text-gray-800">Diagnóstico do último sync</div>
                  <div className="text-[11px] text-gray-500">
                    {diagnostics.length} BMs varridas · {withCatalogs} com catálogos · {withoutAny} sem catálogos · {withAnyError} com erro de permissão/API
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 text-[10px]" onClick={(e) => e.stopPropagation()}>
                {(['all', 'empty', 'errors'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setDiagFilter(f)}
                    className={`px-2 py-1 rounded ${diagFilter === f ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                  >
                    {f === 'all' ? 'Todas' : f === 'empty' ? 'Sem catálogos' : 'Com erro'}
                  </button>
                ))}
              </div>
            </button>

            {diagOpen && (
              <div className="border-t border-gray-100 divide-y divide-gray-100 max-h-[480px] overflow-y-auto">
                {filtered.length === 0 ? (
                  <div className="p-6 text-center text-gray-400 text-xs">
                    Nada pra mostrar com este filtro.
                  </div>
                ) : (
                  filtered.map((d) => {
                    const anyError = d.attempts.some((a) => a.endpoints.some((e) => e.status === 'error'));
                    return (
                      <div key={d.bm_id} className="px-5 py-3 text-xs">
                        <div className="flex items-center gap-3 mb-2">
                          <span className="font-semibold text-gray-800 truncate max-w-[320px]" title={d.bm_name}>{d.bm_name}</span>
                          <span className="font-mono text-[10px] text-gray-400">BM {d.bm_id}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                            d.total_catalogs > 0
                              ? 'bg-emerald-50 text-emerald-600'
                              : anyError
                              ? 'bg-rose-50 text-rose-600'
                              : 'bg-gray-100 text-gray-500'
                          }`}>
                            {d.total_catalogs > 0
                              ? `${d.total_catalogs} catálogo(s)`
                              : anyError ? 'Erro de permissão/API' : 'Sem catálogos'}
                          </span>
                        </div>
                        <div className="space-y-1 pl-2 border-l-2 border-gray-100">
                          {d.attempts.map((a, idx) => (
                            <div key={idx} className="flex flex-wrap items-start gap-2 py-1">
                              <div className="text-[11px] text-gray-600 font-medium min-w-[140px]">
                                {a.profile_name}
                                <span className="text-gray-400 font-mono ml-1">[{a.token_preview}]</span>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {a.endpoints.map((e, eidx) => (
                                  <span
                                    key={eidx}
                                    className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                                      e.status === 'ok'
                                        ? 'bg-emerald-50 text-emerald-700'
                                        : e.status === 'empty'
                                        ? 'bg-gray-100 text-gray-500'
                                        : 'bg-rose-50 text-rose-700'
                                    }`}
                                    title={e.error_message ?? ''}
                                  >
                                    {e.endpoint}: {e.status === 'error'
                                      ? `err ${e.error_code ?? ''}`
                                      : `${e.count}`}
                                  </span>
                                ))}
                                {a.endpoints.some((e) => e.error_message) && (
                                  <span className="text-[10px] text-rose-600 max-w-[420px] truncate">
                                    {a.endpoints.find((e) => e.error_message)?.error_message}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        );
      })()}

      {!loading && !syncing && !error && filtered.length === 0 && (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-12 text-center text-gray-400 text-sm">
          {groups.length === 0
            ? 'Nenhum catálogo no banco. Clique em "Sincronizar Meta" para buscar.'
            : 'Nenhum catálogo encontrado para o filtro atual.'}
        </div>
      )}

      {filtered.map((g) => {
        const isOpen = expanded.has(g.bm_id);
        const bmProductTotal = g.catalogs.reduce((s, c) => s + (c.product_count ?? 0), 0);
        return (
          <div key={g.bm_id} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            {/* BM Header */}
            <div
              onClick={() => toggle(g.bm_id)}
              className="px-5 py-3 border-b border-gray-100 bg-gradient-to-r from-indigo-50/40 to-transparent flex flex-wrap items-center gap-x-6 gap-y-2 cursor-pointer hover:bg-indigo-50/60 transition-colors"
            >
              <div className={`w-5 h-5 flex items-center justify-center rounded bg-gray-100 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}>
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="w-1.5 h-6 bg-indigo-500 rounded-sm" />
              <div className="min-w-0">
                <div className="text-[10px] text-gray-400 font-bold tracking-wider uppercase">Business Manager</div>
                <div className="text-sm font-bold text-gray-800 truncate max-w-[420px]" title={g.bm_name}>
                  {g.bm_name}
                </div>
              </div>
              <div className="text-[10px] text-gray-400 font-mono">BM {g.bm_id}</div>

              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs ml-auto">
                <div className="flex flex-col">
                  <span className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">Catálogos</span>
                  <span className="font-mono font-bold text-gray-800">{g.catalogs.length}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">Produtos</span>
                  <span className="font-mono font-semibold text-gray-800">{formatNumber(bmProductTotal)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">Perfis</span>
                  <span className="font-mono text-gray-500 truncate max-w-[200px]" title={g.accessible_profiles.join(', ')}>
                    {g.accessible_profiles.join(', ') || '—'}
                  </span>
                </div>
              </div>
            </div>

            {/* Catálogos */}
            {isOpen && (
              <>
                {g.catalogs.length === 0 ? (
                  <div className="p-6 text-center text-gray-400 text-xs">
                    Nenhum catálogo nesta BM.
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-12 bg-gray-50 text-[10px] text-gray-500 font-bold uppercase tracking-wider border-b border-gray-200">
                      <div className="col-span-5 px-6 py-3">Catálogo</div>
                      <div className="col-span-3 px-4 py-3">ID</div>
                      <div className="col-span-2 px-4 py-3 text-right">Produtos</div>
                      <div className="col-span-1 px-4 py-3">Vertical</div>
                      <div className="col-span-1 px-4 py-3">Acesso</div>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {g.catalogs.map((c) => (
                        <div key={c.id} className="grid grid-cols-12 text-xs hover:bg-gray-50 transition-colors">
                          <div className="col-span-5 px-6 py-3 font-semibold text-gray-800 break-words">{c.name}</div>
                          <div className="col-span-3 px-4 py-3 font-mono text-gray-400 text-[11px]">{c.id}</div>
                          <div className="col-span-2 px-4 py-3 text-right font-mono text-gray-700">
                            {c.product_count != null ? formatNumber(c.product_count) : '—'}
                          </div>
                          <div className="col-span-1 px-4 py-3 text-gray-500">{c.vertical ?? '—'}</div>
                          <div className="col-span-1 px-4 py-3">
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                              c.relationship === 'owned'
                                ? 'bg-indigo-50 text-indigo-600'
                                : 'bg-amber-50 text-amber-600'
                            }`}>
                              {c.relationship === 'owned' ? 'Owned' : 'Client'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
