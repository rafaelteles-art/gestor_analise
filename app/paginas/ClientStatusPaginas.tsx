'use client';

import React, { useState, useMemo } from 'react';
import { RefreshCw, Search } from 'lucide-react';

interface Page {
  page_id: string;
  page_name: string;
  ad_limit: number | null;
  ads_running: number;
  accessible_profiles: string[];
  updated_at: string;
}

function fmtDate(d: string | Date) {
  try {
    return new Date(d).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function AvailableBadge({ available, limit }: { available: number | null; limit: number | null }) {
  if (limit === null || available === null) {
    return <span className="text-gray-300">—</span>;
  }
  const ratio = limit > 0 ? available / limit : 0;
  let cls = 'bg-green-50 text-green-700';
  if (ratio <= 0) cls = 'bg-red-50 text-red-600';
  else if (ratio < 0.2) cls = 'bg-amber-50 text-amber-700';
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold whitespace-nowrap ${cls}`}>
      {available}
    </span>
  );
}

export default function ClientStatusPaginas({ initialPages }: { initialPages: Page[] }) {
  const [pages] = useState<Page[]>(initialPages);
  const [search, setSearch] = useState('');
  const [filterProfile, setFilterProfile] = useState('');
  const [filterDisponibilidade, setFilterDisponibilidade] = useState('');

  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{
    label: string;
    message: string;
    current: number;
    total: number;
    indeterminate: boolean;
  } | null>(null);

  const uniqueProfiles = useMemo(() => {
    const set = new Set<string>();
    pages.forEach((p) => p.accessible_profiles.forEach((pr) => set.add(pr)));
    return Array.from(set).sort();
  }, [pages]);

  const filteredPages = useMemo(() => {
    return pages.filter((p) => {
      if (filterProfile && !p.accessible_profiles.includes(filterProfile)) return false;
      if (filterDisponibilidade === 'SEM_LIMITE' && p.ad_limit !== null) return false;
      if (filterDisponibilidade === 'COM_LIMITE' && p.ad_limit === null) return false;
      if (filterDisponibilidade === 'DISPONIVEL') {
        if (p.ad_limit === null) return false;
        if (p.ads_running >= p.ad_limit) return false;
      }
      if (filterDisponibilidade === 'CHEIA') {
        if (p.ad_limit === null) return false;
        if (p.ads_running < p.ad_limit) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        if (
          !p.page_name.toLowerCase().includes(q) &&
          !p.page_id.toLowerCase().includes(q) &&
          !p.accessible_profiles.join(' ').toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [pages, search, filterProfile, filterDisponibilidade]);

  const kpis = useMemo(() => {
    const total = filteredPages.length;
    let totalLimit = 0;
    let totalRunning = 0;
    let comLimite = 0;
    let cheias = 0;
    for (const p of filteredPages) {
      if (p.ad_limit !== null) {
        comLimite++;
        totalLimit += p.ad_limit;
        if (p.ads_running >= p.ad_limit) cheias++;
      }
      totalRunning += p.ads_running;
    }
    const disponivel = Math.max(0, totalLimit - totalRunning);
    return { total, comLimite, cheias, totalLimit, totalRunning, disponivel };
  }, [filteredPages]);

  const runStreamedSync = async (url: string, label: string) => {
    setSyncProgress({ label, message: 'Conectando…', current: 0, total: 0, indeterminate: true });

    let success = false;
    let errorMsg: string | null = null;

    try {
      const res = await fetch(url);
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          if (!part.trim()) continue;
          let line: any;
          try {
            line = JSON.parse(part);
          } catch {
            continue;
          }

          if (line.type === 'start') {
            setSyncProgress({
              label,
              message: line.message ?? 'Iniciando…',
              current: 0,
              total: line.total ?? 0,
              indeterminate: !line.total,
            });
          } else if (line.type === 'progress') {
            setSyncProgress((prev) => ({
              label,
              message: line.message ?? prev?.message ?? '',
              current: line.current ?? prev?.current ?? 0,
              total: line.total ?? prev?.total ?? 0,
              indeterminate: line.total == null && !prev?.total,
            }));
          } else if (line.type === 'done') {
            success = !!line.success;
            setSyncProgress((prev) => ({
              label,
              message: line.message ?? 'Concluído',
              current: prev?.total ?? prev?.current ?? 1,
              total: prev?.total ?? 1,
              indeterminate: false,
            }));
          } else if (line.type === 'error') {
            errorMsg = line.error ?? 'Erro desconhecido';
          }
        }
      }
    } catch (err: any) {
      errorMsg = err?.message ?? 'Erro de rede';
    }

    if (errorMsg) {
      alert(`Erro em ${label}: ${errorMsg}`);
      setSyncProgress(null);
      return;
    }

    if (success) {
      setTimeout(() => window.location.reload(), 400);
    } else {
      setSyncProgress(null);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await runStreamedSync('/api/pages/sync', 'Sincronizar Páginas');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Action Bar */}
      <div className="flex justify-end items-center gap-3">
        {syncProgress && (
          <div className="flex-1 max-w-md bg-white border border-gray-200 rounded-xl shadow-sm px-4 py-2">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-xs font-bold text-gray-700 truncate">{syncProgress.label}</span>
              <span className="text-[10px] font-medium text-gray-500 tabular-nums whitespace-nowrap">
                {syncProgress.total > 0
                  ? `${syncProgress.current}/${syncProgress.total} · ${Math.min(100, Math.round((syncProgress.current / syncProgress.total) * 100))}%`
                  : 'em andamento…'}
              </span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              {syncProgress.indeterminate || syncProgress.total === 0 ? (
                <div className="h-full w-1/3 bg-indigo-500 rounded-full animate-[sync-indeterminate_1.2s_ease-in-out_infinite]" />
              ) : (
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.round((syncProgress.current / syncProgress.total) * 100))}%` }}
                />
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-gray-500 truncate">{syncProgress.message}</p>
          </div>
        )}
        <button
          onClick={handleSync}
          disabled={isSyncing}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-xl text-sm font-medium text-white transition-colors shadow-sm disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
          Sincronizar Páginas
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-5 gap-4">
        {[
          { label: 'TOTAL PÁGINAS', value: String(kpis.total),     cls: 'text-gray-800' },
          { label: 'COM LIMITE',    value: String(kpis.comLimite), cls: 'text-gray-800' },
          { label: 'ANÚNCIOS USADOS', value: String(kpis.totalRunning), cls: 'text-indigo-600' },
          { label: 'DISPONÍVEIS',   value: String(kpis.disponivel), cls: 'text-green-600' },
          { label: 'PÁGINAS CHEIAS', value: String(kpis.cheias),   cls: 'text-red-500' },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-2">{kpi.label}</p>
            <p className={`text-2xl font-bold ${kpi.cls}`}>{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-4 flex flex-wrap gap-5 items-end">
        <div className="flex flex-col gap-1 min-w-[150px]">
          <label className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Perfil</label>
          <select
            value={filterProfile}
            onChange={(e) => setFilterProfile(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs w-full outline-none focus:border-indigo-400 bg-gray-50"
          >
            <option value="">Todos</option>
            {uniqueProfiles.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 min-w-[170px]">
          <label className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Disponibilidade</label>
          <select
            value={filterDisponibilidade}
            onChange={(e) => setFilterDisponibilidade(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs w-full outline-none focus:border-indigo-400 bg-gray-50"
          >
            <option value="">Todas</option>
            <option value="DISPONIVEL">Com slots disponíveis</option>
            <option value="CHEIA">No limite</option>
            <option value="COM_LIMITE">Com limite conhecido</option>
            <option value="SEM_LIMITE">Sem limite (N/A)</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, ID ou perfil..."
              className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-xs w-72 outline-none focus:border-indigo-400 bg-gray-50"
            />
          </div>
          <div className="ml-auto text-xs text-gray-400">
            {filteredPages.length} {filteredPages.length === 1 ? 'página' : 'páginas'}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[900px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-[10px] text-gray-500 font-bold uppercase tracking-wider">
                <th className="px-4 py-3">Página</th>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Perfis com acesso</th>
                <th className="px-4 py-3 text-right">Limite total</th>
                <th className="px-4 py-3 text-right">Em uso</th>
                <th className="px-4 py-3 text-right">Disponíveis</th>
                <th className="px-4 py-3">Atualizado em</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredPages.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-sm text-gray-400">
                    Nenhuma página encontrada. Clique em &ldquo;Sincronizar Páginas&rdquo; para importar.
                  </td>
                </tr>
              )}

              {filteredPages.map((p) => {
                const available = p.ad_limit === null ? null : Math.max(0, p.ad_limit - p.ads_running);
                return (
                  <tr key={p.page_id} className="text-xs transition-colors hover:bg-gray-50">
                    <td className="px-4 py-3 font-semibold text-gray-800 whitespace-nowrap">
                      {p.page_name}
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-400 text-[11px]">{p.page_id}</td>
                    <td className="px-4 py-3">
                      {p.accessible_profiles.length === 0 ? (
                        <span className="text-gray-300">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {p.accessible_profiles.map((profile) => (
                            <span
                              key={profile}
                              className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-100"
                            >
                              {profile}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-700">
                      {p.ad_limit === null ? <span className="text-gray-300">N/A</span> : p.ad_limit}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-700">{p.ads_running}</td>
                    <td className="px-4 py-3 text-right">
                      <AvailableBadge available={available} limit={p.ad_limit} />
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-[11px]">
                      {fmtDate(p.updated_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
