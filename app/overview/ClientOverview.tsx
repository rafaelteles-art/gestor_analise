'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { todayStr, fmtDateTime } from '@/lib/timezone';
import { RefreshCw, Database, ChevronRight, ChevronDown, AlertCircle } from 'lucide-react';
import OfferSelector from '../components/OfferSelector';

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

export default function ClientOverview({
  selectedCampaigns,
  offers,
  currentOferta,
}: {
  selectedCampaigns: SelectedCampaign[];
  offers: { id: number; nome: string }[];
  currentOferta: number | null;
}) {
  const [date, setDate] = useState(todayStr());
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
      const ofertaQs = currentOferta != null ? `&oferta=${currentOferta}` : '';
      const res = await fetch(`/api/overview/db?date=${date}${ofertaQs}`);
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
  }, [date, selectedCampaigns.length, currentOferta]);

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
  const roasColor = (r: number) => (r >= 1.5 ? 'text-emerald-600' : r >= 1 ? 'text-amber-600' : r > 0 ? 'text-rose-600' : 'text-console-muted');

  return (
    <div className="flex flex-col gap-5">
      {/* Header controles */}
      <div className="bg-console-surface border border-console-border rounded px-5 py-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-console-muted font-bold">Data</span>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              max={todayStr()}
              className="text-sm font-mono text-foreground bg-console-surface-2 border border-console-border rounded px-2 py-1 outline-none focus:border-amber-500"
            />
          </div>

          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-console-muted font-bold">Campanhas</span>
            <span className="text-sm font-semibold text-foreground">{selectedCampaigns.length} selecionada(s)</span>
          </div>

          <OfferSelector offers={offers} current={currentOferta} />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadFromDb}
            disabled={loading || syncing}
            className="flex items-center gap-2 px-4 py-2 bg-console-surface border border-console-border hover:bg-console-surface-2 rounded text-xs font-semibold text-foreground transition disabled:opacity-40"
          >
            <Database className={`w-3.5 h-3.5 ${loading ? 'animate-pulse' : ''}`} />
            {loading ? 'Lendo...' : 'Sincronizar com o banco'}
          </button>

          <button
            onClick={syncFromApi}
            disabled={syncing || !hasSelection}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 rounded text-xs font-semibold text-white transition disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Sincronizando...' : 'Sincronizar pela API'}
          </button>
        </div>
      </div>

      {/* Painel de log de sync (só visível durante/após sync) */}
      {(syncing || syncLogs.length > 0) && (
        <div className="bg-console-surface border border-console-border rounded p-4 text-xs font-mono max-h-64 overflow-auto">
          {syncProgress && (
            <div className="text-amber-400 mb-2 sticky top-0 bg-console-surface pb-1 border-b border-console-border flex items-center gap-2">
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
        <div className="bg-amber-500/10 border border-amber-500 rounded p-6 text-center">
          <AlertCircle className="w-6 h-6 mx-auto text-amber-500 mb-2" />
          <p className="text-sm text-amber-800 dark:text-amber-400 font-medium">Nenhuma campanha selecionada.</p>
          <p className="text-xs text-amber-700 dark:text-amber-500 mt-1">
            Vá em <a href="/settings" className="underline font-semibold">Configurações → Campanhas RedTrack</a> e selecione campanhas para acompanhar.
          </p>
        </div>
      )}

      {error && (
        <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded p-4 text-sm text-rose-700 dark:text-rose-400">
          <strong>Erro:</strong> {error}
        </div>
      )}

      {/* Tabela */}
      {hasSelection && rows.length > 0 && (
        <div className="bg-console-surface border border-console-border rounded overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-console-surface-2 text-console-muted text-[10px] uppercase tracking-wider">
                <tr>
                  <th className="px-3 py-3 text-left font-semibold w-8"></th>
                  <th className="px-3 py-3 text-left font-semibold">Campanha</th>
                  <th className="px-3 py-3 text-right font-semibold">Cost</th>
                  <th className="px-3 py-3 text-right font-semibold">Total Revenue</th>
                  <th className="px-3 py-3 text-right font-semibold">ROAS</th>
                  <th className="px-3 py-3 text-right font-semibold">Profit</th>
                  <th className="px-3 py-3 text-right font-semibold border-l border-console-border">IC</th>
                  <th className="px-3 py-3 text-right font-semibold">Purchase</th>
                  <th className="px-3 py-3 text-right font-semibold border-l border-console-border">Up1</th>
                  <th className="px-3 py-3 text-right font-semibold">Up2</th>
                  <th className="px-3 py-3 text-right font-semibold">Up3</th>
                  <th className="px-3 py-3 text-right font-semibold">Up4</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-console-border">
                {rows.map(r => {
                  const exp = expanded[r.campaign_id];
                  const isOpen = !!exp;
                  return (
                    <React.Fragment key={r.campaign_id}>
                      <tr
                        className={`border-l-2 transition-colors cursor-pointer ${isOpen ? 'border-amber-500 bg-amber-500/5' : 'border-transparent hover:border-amber-500 hover:bg-console-surface-2'}`}
                        onClick={() => toggleAds(r.campaign_id)}
                      >
                        <td className="px-3 py-2.5 text-console-muted">
                          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-semibold text-foreground max-w-[480px] truncate" title={r.campaign_name}>
                            {r.campaign_name}
                          </div>
                          {!r.has_data && (
                            <div className="text-[10px] text-console-muted mt-0.5">
                              sem dados no banco para esta data — sincronize pela API
                            </div>
                          )}
                          {r.synced_at && (
                            <div className="text-[10px] text-console-muted mt-0.5">
                              sync: {fmtDateTime(r.synced_at)}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-rose-500">{fmtBRL(r.cost)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-foreground">{fmtBRL(r.total_revenue)}</td>
                        <td className={`px-3 py-2.5 text-right font-mono font-bold ${roasColor(r.roas)}`}>{fmtRoas(r.roas)}</td>
                        <td className={`px-3 py-2.5 text-right font-mono font-bold ${profitColor(r.profit)}`}>{fmtBRL(r.profit)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-foreground border-l border-console-border">{fmtNum(r.ic_count)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-foreground">{fmtNum(r.purchase_count)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-foreground border-l border-console-border">{fmtNum(r.up1_count)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-foreground">{fmtNum(r.up2_count)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-foreground">{fmtNum(r.up3_count)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-foreground">{fmtNum(r.up4_count)}</td>
                      </tr>

                      {isOpen && (
                        <tr className="bg-amber-500/5">
                          <td colSpan={12} className="px-6 py-4 border-b border-console-border">
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
                <tfoot className="bg-console-surface-2 border-t-2 border-console-border text-xs font-bold">
                  <tr>
                    <td className="px-3 py-3"></td>
                    <td className="px-3 py-3 text-foreground uppercase tracking-wider text-[10px]">Total</td>
                    <td className="px-3 py-3 text-right font-mono text-rose-600">{fmtBRL(totals.cost)}</td>
                    <td className="px-3 py-3 text-right font-mono text-foreground">{fmtBRL(totals.total_revenue)}</td>
                    <td className={`px-3 py-3 text-right font-mono ${roasColor(totals.roas)}`}>{fmtRoas(totals.roas)}</td>
                    <td className={`px-3 py-3 text-right font-mono ${profitColor(totals.profit)}`}>{fmtBRL(totals.profit)}</td>
                    <td className="px-3 py-3 text-right font-mono text-foreground border-l border-console-border">{fmtNum(totals.ic_count)}</td>
                    <td className="px-3 py-3 text-right font-mono text-foreground">{fmtNum(totals.purchase_count)}</td>
                    <td className="px-3 py-3 text-right font-mono text-foreground border-l border-console-border">{fmtNum(totals.up1_count)}</td>
                    <td className="px-3 py-3 text-right font-mono text-foreground">{fmtNum(totals.up2_count)}</td>
                    <td className="px-3 py-3 text-right font-mono text-foreground">{fmtNum(totals.up3_count)}</td>
                    <td className="px-3 py-3 text-right font-mono text-foreground">{fmtNum(totals.up4_count)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {hasSelection && rows.length === 0 && !loading && !error && (
        <div className="bg-console-surface border border-console-border rounded p-10 text-center text-sm text-console-muted">
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
    return <div className="text-xs text-console-muted italic py-2">Carregando criativos...</div>;
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
  const roasColor = (r: number) => (r >= 1.5 ? 'text-emerald-600' : r >= 1 ? 'text-amber-600' : r > 0 ? 'text-rose-600' : 'text-console-muted');

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] text-console-muted">
          {ads.length} ad(s){' '}
          {state.source && (
            <span className="text-console-muted">
              · fonte: {state.source === 'cache' ? 'cache' : 'API ao vivo'}
              {state.synced_at && ` · ${fmtDateTime(state.synced_at)}`}
            </span>
          )}
        </div>
        <button
          onClick={onRefresh}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-amber-400 bg-console-surface border border-amber-500 rounded hover:bg-amber-500/10 transition"
        >
          <RefreshCw className="w-3 h-3" /> Buscar da API
        </button>
      </div>

      {ads.length === 0 ? (
        <div className="text-xs text-console-muted italic py-4 text-center">Sem ads com tráfego nesta data.</div>
      ) : (
        <div className="overflow-x-auto bg-console-surface rounded border border-console-border">
          <table className="w-full text-[11px]">
            <thead className="bg-console-surface-2 text-console-muted text-[9px] uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">rt_ad</th>
                <th className="px-3 py-2 text-right font-semibold">Cost</th>
                <th className="px-3 py-2 text-right font-semibold">Total Revenue</th>
                <th className="px-3 py-2 text-right font-semibold">ROAS</th>
                <th className="px-3 py-2 text-right font-semibold">Profit</th>
                <th className="px-3 py-2 text-right font-semibold border-l border-console-border">IC</th>
                <th className="px-3 py-2 text-right font-semibold">Purch</th>
                <th className="px-3 py-2 text-right font-semibold border-l border-console-border">Up1</th>
                <th className="px-3 py-2 text-right font-semibold">Up2</th>
                <th className="px-3 py-2 text-right font-semibold">Up3</th>
                <th className="px-3 py-2 text-right font-semibold">Up4</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-console-border">
              {ads
                .sort((a, b) => b.cost - a.cost)
                .map((a, i) => (
                  <tr key={i} className="border-l-2 border-transparent hover:border-amber-500 hover:bg-console-surface-2 transition-colors">
                    <td className="px-3 py-2 font-mono font-semibold text-foreground">{a.rt_ad}</td>
                    <td className="px-3 py-2 text-right font-mono text-rose-500">{fmtBRL(a.cost)}</td>
                    <td className="px-3 py-2 text-right font-mono text-foreground">{fmtBRL(a.total_revenue)}</td>
                    <td className={`px-3 py-2 text-right font-mono font-bold ${roasColor(a.roas)}`}>{fmtRoas(a.roas)}</td>
                    <td className={`px-3 py-2 text-right font-mono font-bold ${profitColor(a.profit)}`}>{fmtBRL(a.profit)}</td>
                    <td className="px-3 py-2 text-right font-mono text-foreground border-l border-console-border">{fmtNum(a.ic_count)}</td>
                    <td className="px-3 py-2 text-right font-mono text-foreground">{fmtNum(a.purchase_count)}</td>
                    <td className="px-3 py-2 text-right font-mono text-foreground border-l border-console-border">{fmtNum(a.up1_count)}</td>
                    <td className="px-3 py-2 text-right font-mono text-foreground">{fmtNum(a.up2_count)}</td>
                    <td className="px-3 py-2 text-right font-mono text-foreground">{fmtNum(a.up3_count)}</td>
                    <td className="px-3 py-2 text-right font-mono text-foreground">{fmtNum(a.up4_count)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
