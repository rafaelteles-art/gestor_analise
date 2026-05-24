'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { format } from 'date-fns';
import { RefreshCw, Database, ChevronRight, ChevronDown, AlertCircle } from 'lucide-react';

interface SelectedCampaign {
  campaign_id: string;
  campaign_name: string;
  status: string;
}

interface OverviewRow {
  campaign_id: string;
  campaign_name: string;
  status?: string;
  cost: number;
  total_revenue: number;
  profit: number;
  roas: number;
  ic_count: number;
  purchase_count: number;
  up1_count: number;
  up2_count: number;
  up3_count: number;
  up4_count: number;
  synced_at?: string | null;
  has_data?: boolean;
}

interface OverviewTotals {
  cost: number;
  total_revenue: number;
  profit: number;
  roas: number;
  ic_count: number;
  purchase_count: number;
  up1_count: number;
  up2_count: number;
  up3_count: number;
  up4_count: number;
}

interface AdRow {
  rt_ad: string;
  cost: number;
  total_revenue: number;
  profit: number;
  roas: number;
  clicks: number;
  conversions: number;
  ic_count: number;
  purchase_count: number;
  up1_count: number;
  up2_count: number;
  up3_count: number;
  up4_count: number;
}

interface SyncLog {
  ts: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtNum = (v: number) => v.toLocaleString('pt-BR');
const fmtRoas = (v: number) => (v > 0 ? v.toFixed(2) + 'x' : '—');

export default function ClientOverview({ selectedCampaigns }: { selectedCampaigns: SelectedCampaign[] }) {
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [rows, setRows] = useState<OverviewRow[]>([]);
  const [totals, setTotals] = useState<OverviewTotals | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [syncProgress, setSyncProgress] = useState<{ index: number; total: number; campaign: string } | null>(null);

  const [expanded, setExpanded] = useState<Record<string, { loading: boolean; error?: string; ads?: AdRow[]; source?: string; synced_at?: string }>>({});

  // 1. Carrega métricas do banco para a data atual
  const loadFromDb = useCallback(async () => {
    if (selectedCampaigns.length === 0) {
      setRows([]); setTotals(null); return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/overview/db?date=${date}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao ler banco');
      setRows(data.rows || []);
      setTotals(data.totals || null);
    } catch (e: any) {
      setError(e.message);
      setRows([]); setTotals(null);
    } finally {
      setLoading(false);
    }
  }, [date, selectedCampaigns.length]);

  useEffect(() => { loadFromDb(); }, [loadFromDb]);

  // 2. Sincronizar pela API (RedTrack -> redtrack_metrics)
  const syncFromApi = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncLogs([]);
    setSyncProgress(null);
    try {
      const res = await fetch('/api/overview/sync-today', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      });
      if (!res.ok || !res.body) {
        const txt = await res.text().catch(() => '');
        throw new Error(txt || `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.type === 'log') {
              setSyncLogs(l => [...l, { ts: evt.ts, level: evt.level, message: evt.message }]);
            } else if (evt.type === 'progress') {
              setSyncProgress({ index: evt.index, total: evt.total, campaign: evt.campaign });
            } else if (evt.type === 'done') {
              setSyncProgress(null);
            } else if (evt.type === 'start') {
              setSyncLogs(l => [...l, { ts: Date.now(), level: 'info', message: `Iniciado · ${evt.total} campanha(s) · ${evt.date}` }]);
            }
          } catch {}
        }
      }
      await loadFromDb();
    } catch (e: any) {
      setSyncLogs(l => [...l, { ts: Date.now(), level: 'error', message: 'Falha: ' + e.message }]);
    } finally {
      setSyncing(false);
    }
  };

  // 3. Toggle ads dropdown
  const toggleAds = async (campaignId: string, fresh = false) => {
    const cur = expanded[campaignId];
    if (cur && !fresh) {
      // Já aberto — fecha
      setExpanded(e => { const next = { ...e }; delete next[campaignId]; return next; });
      return;
    }
    setExpanded(e => ({ ...e, [campaignId]: { loading: true } }));
    try {
      const res = await fetch(`/api/overview/ads?campaign_id=${campaignId}&date=${date}${fresh ? '&fresh=1' : ''}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro');
      setExpanded(e => ({
        ...e,
        [campaignId]: {
          loading: false,
          ads: data.ads || [],
          source: data.source,
          synced_at: data.synced_at,
        },
      }));
    } catch (e: any) {
      setExpanded(ex => ({ ...ex, [campaignId]: { loading: false, error: e.message } }));
    }
  };

  const hasSelection = selectedCampaigns.length > 0;
  const profitColor = (p: number) => (p >= 0 ? 'text-emerald-600' : 'text-rose-600');
  const roasColor = (r: number) => (r >= 1.5 ? 'text-emerald-600' : r >= 1 ? 'text-amber-600' : r > 0 ? 'text-rose-600' : 'text-gray-400');

  return (
    <div className="flex flex-col gap-5">
      {/* Header controles */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm px-5 py-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Data</span>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              max={format(new Date(), 'yyyy-MM-dd')}
              className="text-sm font-mono text-gray-700 bg-gray-50 border border-gray-200 rounded-md px-2 py-1 outline-none focus:border-indigo-400"
            />
          </div>

          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Campanhas</span>
            <span className="text-sm font-semibold text-gray-700">{selectedCampaigns.length} selecionada(s)</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadFromDb}
            disabled={loading || syncing}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg text-xs font-semibold text-gray-700 transition disabled:opacity-40"
          >
            <Database className={`w-3.5 h-3.5 ${loading ? 'animate-pulse' : ''}`} />
            {loading ? 'Lendo...' : 'Sincronizar com o banco'}
          </button>

          <button
            onClick={syncFromApi}
            disabled={syncing || !hasSelection}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg text-xs font-semibold text-white transition disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Sincronizando...' : 'Sincronizar pela API'}
          </button>
        </div>
      </div>

      {/* Painel de log de sync (só visível durante/após sync) */}
      {(syncing || syncLogs.length > 0) && (
        <div className="bg-gray-900 text-gray-100 rounded-xl p-4 text-xs font-mono max-h-64 overflow-auto shadow-inner">
          {syncProgress && (
            <div className="text-indigo-300 mb-2 sticky top-0 bg-gray-900 pb-1 border-b border-gray-800 flex items-center gap-2">
              <RefreshCw className="w-3 h-3 animate-spin" />
              [{syncProgress.index}/{syncProgress.total}] {syncProgress.campaign}
            </div>
          )}
          {syncLogs.map((l, i) => (
            <div
              key={i}
              className={
                l.level === 'error' ? 'text-rose-400' :
                l.level === 'warn'  ? 'text-amber-300' :
                                      'text-gray-300'
              }
            >
              {l.message}
            </div>
          ))}
        </div>
      )}

      {/* Estados */}
      {!hasSelection && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
          <AlertCircle className="w-6 h-6 mx-auto text-amber-500 mb-2" />
          <p className="text-sm text-amber-800 font-medium">Nenhuma campanha selecionada.</p>
          <p className="text-xs text-amber-700 mt-1">
            Vá em <a href="/settings" className="underline font-semibold">Configurações → Campanhas RedTrack</a> e selecione campanhas para acompanhar.
          </p>
        </div>
      )}

      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-sm text-rose-700">
          <strong>Erro:</strong> {error}
        </div>
      )}

      {/* Tabela */}
      {hasSelection && rows.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500 text-[10px] uppercase tracking-wider">
                <tr>
                  <th className="px-3 py-3 text-left font-semibold w-8"></th>
                  <th className="px-3 py-3 text-left font-semibold">Campanha</th>
                  <th className="px-3 py-3 text-right font-semibold">Cost</th>
                  <th className="px-3 py-3 text-right font-semibold">Total Revenue</th>
                  <th className="px-3 py-3 text-right font-semibold">ROAS</th>
                  <th className="px-3 py-3 text-right font-semibold">Profit</th>
                  <th className="px-3 py-3 text-right font-semibold border-l border-gray-200">IC</th>
                  <th className="px-3 py-3 text-right font-semibold">Purchase</th>
                  <th className="px-3 py-3 text-right font-semibold border-l border-gray-200">Up1</th>
                  <th className="px-3 py-3 text-right font-semibold">Up2</th>
                  <th className="px-3 py-3 text-right font-semibold">Up3</th>
                  <th className="px-3 py-3 text-right font-semibold">Up4</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(r => {
                  const exp = expanded[r.campaign_id];
                  const isOpen = !!exp;
                  return (
                    <React.Fragment key={r.campaign_id}>
                      <tr
                        className={`hover:bg-indigo-50/40 transition-colors cursor-pointer ${isOpen ? 'bg-indigo-50/30' : ''}`}
                        onClick={() => toggleAds(r.campaign_id)}
                      >
                        <td className="px-3 py-2.5 text-gray-400">
                          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-semibold text-gray-800 max-w-[480px] truncate" title={r.campaign_name}>
                            {r.campaign_name}
                          </div>
                          {!r.has_data && (
                            <div className="text-[10px] text-gray-400 mt-0.5">
                              sem dados no banco para esta data — sincronize pela API
                            </div>
                          )}
                          {r.synced_at && (
                            <div className="text-[10px] text-gray-400 mt-0.5">
                              sync: {new Date(r.synced_at).toLocaleString('pt-BR')}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-rose-500">{fmtBRL(r.cost)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-gray-800">{fmtBRL(r.total_revenue)}</td>
                        <td className={`px-3 py-2.5 text-right font-mono font-bold ${roasColor(r.roas)}`}>{fmtRoas(r.roas)}</td>
                        <td className={`px-3 py-2.5 text-right font-mono font-bold ${profitColor(r.profit)}`}>{fmtBRL(r.profit)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-gray-700 border-l border-gray-100">{fmtNum(r.ic_count)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-gray-700">{fmtNum(r.purchase_count)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-gray-700 border-l border-gray-100">{fmtNum(r.up1_count)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-gray-700">{fmtNum(r.up2_count)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-gray-700">{fmtNum(r.up3_count)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-gray-700">{fmtNum(r.up4_count)}</td>
                      </tr>

                      {isOpen && (
                        <tr className="bg-indigo-50/20">
                          <td colSpan={12} className="px-6 py-4 border-b border-indigo-100">
                            <AdsPanel
                              state={exp}
                              onRefresh={() => toggleAds(r.campaign_id, true)}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>

              {totals && rows.length > 0 && (
                <tfoot className="bg-gray-50/80 border-t-2 border-gray-200 text-xs font-bold">
                  <tr>
                    <td className="px-3 py-3"></td>
                    <td className="px-3 py-3 text-gray-700 uppercase tracking-wider text-[10px]">Total</td>
                    <td className="px-3 py-3 text-right font-mono text-rose-600">{fmtBRL(totals.cost)}</td>
                    <td className="px-3 py-3 text-right font-mono text-gray-900">{fmtBRL(totals.total_revenue)}</td>
                    <td className={`px-3 py-3 text-right font-mono ${roasColor(totals.roas)}`}>{fmtRoas(totals.roas)}</td>
                    <td className={`px-3 py-3 text-right font-mono ${profitColor(totals.profit)}`}>{fmtBRL(totals.profit)}</td>
                    <td className="px-3 py-3 text-right font-mono text-gray-800 border-l border-gray-200">{fmtNum(totals.ic_count)}</td>
                    <td className="px-3 py-3 text-right font-mono text-gray-800">{fmtNum(totals.purchase_count)}</td>
                    <td className="px-3 py-3 text-right font-mono text-gray-800 border-l border-gray-200">{fmtNum(totals.up1_count)}</td>
                    <td className="px-3 py-3 text-right font-mono text-gray-800">{fmtNum(totals.up2_count)}</td>
                    <td className="px-3 py-3 text-right font-mono text-gray-800">{fmtNum(totals.up3_count)}</td>
                    <td className="px-3 py-3 text-right font-mono text-gray-800">{fmtNum(totals.up4_count)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {hasSelection && rows.length === 0 && !loading && !error && (
        <div className="bg-white border border-gray-100 rounded-xl p-10 text-center text-sm text-gray-400">
          Sem campanhas selecionadas com dados nesta data.
        </div>
      )}
    </div>
  );
}

// ============================================================
// Painel de ads (dropdown)
// ============================================================
function AdsPanel({
  state,
  onRefresh,
}: {
  state: { loading: boolean; error?: string; ads?: AdRow[]; source?: string; synced_at?: string };
  onRefresh: () => void;
}) {
  if (state.loading) {
    return <div className="text-xs text-gray-500 italic py-2">Carregando criativos...</div>;
  }
  if (state.error) {
    return (
      <div className="text-xs text-rose-600">
        Erro ao carregar ads: {state.error}
        <button onClick={onRefresh} className="ml-2 underline font-semibold">tentar novamente</button>
      </div>
    );
  }
  const ads = (state.ads || []).filter(a => a.rt_ad && a.rt_ad !== '(sem rt_ad)' && (a.cost > 0 || a.total_revenue > 0 || a.clicks > 0));
  const profitColor = (p: number) => (p >= 0 ? 'text-emerald-600' : 'text-rose-600');
  const roasColor = (r: number) => (r >= 1.5 ? 'text-emerald-600' : r >= 1 ? 'text-amber-600' : r > 0 ? 'text-rose-600' : 'text-gray-400');

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] text-gray-500">
          {ads.length} ad(s){' '}
          {state.source && (
            <span className="text-gray-400">
              · fonte: {state.source === 'cache' ? 'cache' : 'API ao vivo'}
              {state.synced_at && ` · ${new Date(state.synced_at).toLocaleString('pt-BR')}`}
            </span>
          )}
        </div>
        <button
          onClick={onRefresh}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-indigo-700 bg-white border border-indigo-200 rounded hover:bg-indigo-50 transition"
        >
          <RefreshCw className="w-3 h-3" /> Buscar da API
        </button>
      </div>

      {ads.length === 0 ? (
        <div className="text-xs text-gray-400 italic py-4 text-center">Sem ads com tráfego nesta data.</div>
      ) : (
        <div className="overflow-x-auto bg-white rounded-lg border border-gray-200">
          <table className="w-full text-[11px]">
            <thead className="bg-gray-50 text-gray-500 text-[9px] uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">rt_ad</th>
                <th className="px-3 py-2 text-right font-semibold">Cost</th>
                <th className="px-3 py-2 text-right font-semibold">Total Revenue</th>
                <th className="px-3 py-2 text-right font-semibold">ROAS</th>
                <th className="px-3 py-2 text-right font-semibold">Profit</th>
                <th className="px-3 py-2 text-right font-semibold border-l border-gray-200">IC</th>
                <th className="px-3 py-2 text-right font-semibold">Purch</th>
                <th className="px-3 py-2 text-right font-semibold border-l border-gray-200">Up1</th>
                <th className="px-3 py-2 text-right font-semibold">Up2</th>
                <th className="px-3 py-2 text-right font-semibold">Up3</th>
                <th className="px-3 py-2 text-right font-semibold">Up4</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {ads
                .sort((a, b) => b.cost - a.cost)
                .map((a, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono font-semibold text-gray-800">{a.rt_ad}</td>
                    <td className="px-3 py-2 text-right font-mono text-rose-500">{fmtBRL(a.cost)}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-800">{fmtBRL(a.total_revenue)}</td>
                    <td className={`px-3 py-2 text-right font-mono font-bold ${roasColor(a.roas)}`}>{fmtRoas(a.roas)}</td>
                    <td className={`px-3 py-2 text-right font-mono font-bold ${profitColor(a.profit)}`}>{fmtBRL(a.profit)}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-700 border-l border-gray-100">{fmtNum(a.ic_count)}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-700">{fmtNum(a.purchase_count)}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-700 border-l border-gray-100">{fmtNum(a.up1_count)}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-700">{fmtNum(a.up2_count)}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-700">{fmtNum(a.up3_count)}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-700">{fmtNum(a.up4_count)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
