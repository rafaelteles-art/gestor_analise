'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { todayStr, daysAgoStr } from '@/lib/timezone';
import Select from 'react-select';
import { darkAwareSelectStyles } from '@/app/lib/reactSelectStyles';
import OfferSelector from '../components/OfferSelector';
import {
  analyzeAccounts,
  AccountDiagnostic,
  CreativeDiagnostic,
  Suggestion,
  CreativeCategory,
  Priority,
  RecoveryVerdict,
  RecoverySignalType,
} from './diagnostics';

interface AdAccount {
  account_id: string;
  account_name: string;
  bm_id: string;
  bm_name: string;
}

interface RtCampaign {
  id: string;
  campaign_id: string;
  campaign_name: string;
}

interface Props {
  dbAccounts: AdAccount[];
  rtCampaigns: RtCampaign[];
  offers: { id: number; nome: string }[];
  currentOferta: number | null;
}

// ============================================================
// UI helpers
// ============================================================
const formatBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const formatBRLD = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatNum = (v: number) => v.toLocaleString('pt-BR');
const formatPct = (v: number) => v.toFixed(1) + '%';

const CATEGORY_STYLE: Record<CreativeCategory, { label: string; color: string; bg: string; border: string; emoji: string }> = {
  winner: { label: 'Vencedor', color: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/40', border: 'border-emerald-200 dark:border-emerald-800', emoji: '🏆' },
  promise: { label: 'Promissor', color: 'text-sky-700 dark:text-sky-400', bg: 'bg-sky-50 dark:bg-sky-950/40', border: 'border-sky-200 dark:border-sky-800', emoji: '✨' },
  stable: { label: 'Estável', color: 'text-foreground', bg: 'bg-gray-50 dark:bg-gray-900/40', border: 'border-gray-200 dark:border-gray-800', emoji: '⚖️' },
  underperformer: { label: 'Abaixo da média', color: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/40', border: 'border-amber-200 dark:border-amber-800', emoji: '⚠️' },
  loser: { label: 'Prejuízo', color: 'text-rose-700 dark:text-rose-400', bg: 'bg-rose-50 dark:bg-rose-950/40', border: 'border-rose-200 dark:border-rose-800', emoji: '🩸' },
  zombie: { label: 'Zumbi', color: 'text-slate-700 dark:text-slate-300', bg: 'bg-slate-100 dark:bg-slate-900/40', border: 'border-slate-300 dark:border-slate-700', emoji: '💀' },
};

const PRIORITY_STYLE: Record<Priority, { label: string; color: string; bg: string; border: string }> = {
  P0: { label: 'Urgente', color: 'text-rose-700 dark:text-rose-400', bg: 'bg-rose-50 dark:bg-rose-950/40', border: 'border-rose-300 dark:border-rose-800' },
  P1: { label: 'Importante', color: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/40', border: 'border-amber-300 dark:border-amber-800' },
  P2: { label: 'Quando possível', color: 'text-sky-700 dark:text-sky-400', bg: 'bg-sky-50 dark:bg-sky-950/40', border: 'border-sky-300 dark:border-sky-800' },
};

const VERDICT_STYLE: Record<RecoveryVerdict, { label: string; color: string; bg: string; border: string; emoji: string }> = {
  pause:   { label: 'Pausar',    color: 'text-rose-700 dark:text-rose-400',    bg: 'bg-rose-50 dark:bg-rose-950/40',    border: 'border-rose-200 dark:border-rose-800',    emoji: '⏸' },
  observe: { label: 'Observar',  color: 'text-amber-700 dark:text-amber-400',  bg: 'bg-amber-50 dark:bg-amber-950/40',  border: 'border-amber-200 dark:border-amber-800',  emoji: '👀' },
  rescue:  { label: 'Resgatar',  color: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/40', border: 'border-emerald-200 dark:border-emerald-800', emoji: '🛟' },
};

const SIGNAL_EMOJI: Record<RecoverySignalType, string> = {
  high_ctr: '🎯',
  low_cpm: '💰',
  cross_account_winner: '🌐',
  family_winner: '📈',
  under_tested: '🔬',
  early_phase: '⏱',
  has_sales: '🛒',
};

const ACTION_EMOJI: Record<Suggestion['action'], string> = {
  pause: '⏸',
  duplicate: '📋',
  new_test: '🧪',
  consolidate: '🔗',
  investigate: '🔍',
};

const HEALTH_STYLE: Record<AccountDiagnostic['health'], { label: string; color: string; bg: string; dot: string }> = {
  healthy: { label: 'Saudável', color: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/40', dot: 'bg-emerald-500' },
  watch: { label: 'Atenção', color: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/40', dot: 'bg-amber-500' },
  critical: { label: 'Crítica', color: 'text-rose-700 dark:text-rose-400', bg: 'bg-rose-50 dark:bg-rose-950/40', dot: 'bg-rose-500' },
};

// ============================================================
// Main component
// ============================================================
export default function ClientAnalise({ dbAccounts, rtCampaigns, offers, currentOferta }: Props) {
  const sortedAccounts = [...dbAccounts].sort((a, b) => a.account_name.localeCompare(b.account_name));
  const sortedRtCampaigns = [...rtCampaigns].sort((a, b) => a.campaign_name.localeCompare(b.campaign_name));

  // Stable signatures of the offer-scoped sets, derived from PROPS only. When the
  // offer changes (URL navigation re-renders with new props), these keys change
  // and the scope effect re-applies the account/RT default-to-all for the scope.
  const accountScopeKey = sortedAccounts.map(a => a.account_id).join(',');
  const rtScopeKey = sortedRtCampaigns.map(c => c.campaign_id).join(',');

  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [selectedRtCampaignId, setSelectedRtCampaignId] = useState<string>('');
  const [dateRangeFilter, setDateRangeFilter] = useState<'7d' | '14d' | '30d' | '90d' | 'custom'>('30d');
  const [dateFrom, setDateFrom] = useState(daysAgoStr(29));
  const [dateTo, setDateTo] = useState(todayStr());

  const [isLoading, setIsLoading] = useState(false);
  const [rawData, setRawData] = useState<{ groups: any[]; perAccount: any[]; totals: any } | null>(null);
  const [diagnostics, setDiagnostics] = useState<AccountDiagnostic[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Filtros UI
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<CreativeCategory | 'all'>('all');

  // Scope restore: re-applies the account + RT-campaign default-to-all selection
  // whenever the offer-scoped set changes (offer switch via navigation, or first
  // load with a given ?oferta). Keys derive from PROPS only to avoid render loops.
  useEffect(() => {
    // Default-to-ALL within the offer scope: every offer-scoped account is
    // selected so the user needn't pick anything.
    let initAcc: string[] = sortedAccounts.map(a => a.account_id);
    // RT single-select default semantics: first offer-scoped campaign (or '').
    let initRt = sortedRtCampaigns.length > 0 ? sortedRtCampaigns[0].campaign_id : '';
    try {
      const saved = JSON.parse(localStorage.getItem('dopscale_prefs') || '{}');
      // Intersect stored account ids with the current offer-scoped set; only use
      // the stored set if the intersection is non-empty, else default to all.
      if (Array.isArray(saved.accountIds)) {
        const valid = saved.accountIds.filter((id: string) => sortedAccounts.some(a => a.account_id === id));
        if (valid.length > 0) initAcc = valid;
      } else if (saved.accountId && sortedAccounts.some(a => a.account_id === saved.accountId)) {
        initAcc = [saved.accountId];
      }
      // Only restore the stored RT campaign if present in the offer-scoped list.
      if (saved.rtCampaignId && sortedRtCampaigns.some(c => c.campaign_id === saved.rtCampaignId)) {
        initRt = saved.rtCampaignId;
      }
    } catch {}
    setSelectedAccountIds(initAcc);
    setSelectedRtCampaignId(initRt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountScopeKey, rtScopeKey]);

  // Salva preferências quando mudam
  useEffect(() => {
    if (selectedAccountIds.length === 0 || !selectedRtCampaignId) return;
    try {
      const existing = JSON.parse(localStorage.getItem('dopscale_prefs') || '{}');
      localStorage.setItem(
        'dopscale_prefs',
        JSON.stringify({
          ...existing,
          accountIds: selectedAccountIds,
          rtCampaignId: selectedRtCampaignId,
        }),
      );
    } catch {}
  }, [selectedAccountIds, selectedRtCampaignId]);

  const handleDateShortcut = (r: '7d' | '14d' | '30d' | '90d') => {
    setDateRangeFilter(r);
    const days = r === '7d' ? 6 : r === '14d' ? 13 : r === '30d' ? 29 : 89;
    setDateFrom(daysAgoStr(days));
    setDateTo(todayStr());
  };

  const runAnalysis = async () => {
    if (selectedAccountIds.length === 0 || !selectedRtCampaignId) return;
    setIsLoading(true);
    setError(null);
    try {
      const accs = sortedAccounts.filter(a => selectedAccountIds.includes(a.account_id));
      const camp = sortedRtCampaigns.find(c => c.campaign_id === selectedRtCampaignId);

      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dateFrom,
          dateTo,
          accounts: accs,
          rtCampaigns: camp ? [camp] : [],
          filterRegex: '',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao carregar dados');

      setRawData({
        groups: data.data || [],
        perAccount: data.per_account_totals || [],
        totals: data.rt_totals || null,
      });

      const accTotals = (data.per_account_totals || []).map((t: any) => ({
        account_id: t.account_id,
        account_name: t.account_name,
        cost: t.cost,
        revenue: t.revenue,
        profit: t.profit,
        conversions: t.conversions,
        roas: t.roas,
        cpa: t.cpa,
      }));

      const diags = analyzeAccounts(data.data || [], accTotals);
      setDiagnostics(diags);

      // Auto-expand primeira conta
      if (diags.length > 0) {
        setExpandedAccounts(new Set([diags[0].account_id]));
      }
    } catch (e: any) {
      setError(e.message || 'Erro desconhecido');
      setDiagnostics([]);
      setRawData(null);
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-run ao mudar filtros
  useEffect(() => {
    if (selectedAccountIds.length > 0 && selectedRtCampaignId) {
      runAnalysis();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountIds, selectedRtCampaignId, dateFrom, dateTo]);

  // Agregação global das sugestões (para overview)
  const globalSummary = useMemo(() => {
    if (diagnostics.length === 0) return null;
    const allSugs = diagnostics.flatMap(d => d.suggestions);
    const byPriority: Record<Priority, number> = { P0: 0, P1: 0, P2: 0 };
    for (const s of allSugs) byPriority[s.priority]++;
    const totalSavings = allSugs
      .filter(s => s.estimated_daily_brl && s.estimated_daily_brl < 0)
      .reduce((s, x) => s + Math.abs(x.estimated_daily_brl || 0), 0);
    const cats: Record<CreativeCategory, number> = {
      winner: 0, promise: 0, stable: 0, underperformer: 0, loser: 0, zombie: 0,
    };
    // Veredicto de recuperação — só conta sobre criativos ruins
    const verdictCount: Record<RecoveryVerdict, number> = { pause: 0, observe: 0, rescue: 0 };
    for (const d of diagnostics) {
      for (const c of d.creatives) {
        cats[c.category]++;
        if (c.recovery && ['zombie', 'loser', 'underperformer'].includes(c.category)) {
          verdictCount[c.recovery.verdict]++;
        }
      }
    }
    return {
      accounts: diagnostics.length,
      totalSuggestions: allSugs.length,
      byPriority,
      totalSavings,
      categoriesCount: cats,
      verdictCount,
      healthDist: diagnostics.reduce(
        (acc, d) => {
          acc[d.health]++;
          return acc;
        },
        { healthy: 0, watch: 0, critical: 0 },
      ),
    };
  }, [diagnostics]);

  const toggleAccount = (id: string) =>
    setExpandedAccounts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const pillClass = (range: string) => {
    const base = 'px-4 py-1.5 text-xs font-semibold rounded-md transition-colors ';
    return dateRangeFilter === range
      ? base + 'bg-amber-500 text-white'
      : base + 'text-console-muted hover:bg-console-surface-2 border border-transparent';
  };

  return (
    <div className="flex flex-col gap-6">
      {/* ============================================================
          1. Header de controles
          ============================================================ */}
      <div className="flex flex-wrap md:flex-nowrap items-center justify-between gap-4 bg-console-surface p-4 rounded border border-console-border">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="min-w-[250px]">
            <Select
              instanceId="analise-rt-campaign"
              options={sortedRtCampaigns.map(c => ({ value: c.campaign_id, label: c.campaign_name }))}
              value={
                sortedRtCampaigns
                  .map(c => ({ value: c.campaign_id, label: c.campaign_name }))
                  .find(o => o.value === selectedRtCampaignId) || null
              }
              onChange={(s: any) => setSelectedRtCampaignId(s?.value || '')}
              placeholder="Selecione RedTrack"
              className="text-sm rounded"
              styles={darkAwareSelectStyles}
            />
          </div>

          <div className="min-w-[320px]">
            <Select
              instanceId="analise-meta-account"
              isMulti
              closeMenuOnSelect={false}
              options={sortedAccounts.map(a => ({ value: a.account_id, label: a.account_name }))}
              value={sortedAccounts
                .filter(a => selectedAccountIds.includes(a.account_id))
                .map(a => ({ value: a.account_id, label: a.account_name }))}
              onChange={(s: any) => setSelectedAccountIds((s || []).map((o: any) => o.value))}
              placeholder="Selecione contas Meta"
              className="text-sm rounded"
              styles={darkAwareSelectStyles}
            />
          </div>

          <OfferSelector offers={offers} current={currentOferta} />

          <button
            onClick={runAnalysis}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 hover:border-amber-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg
              className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`}
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
              />
            </svg>
            {isLoading ? 'Analisando...' : 'Reanalisar'}
          </button>
        </div>

        <div className="flex items-center gap-1 border border-console-border rounded p-1 bg-console-surface">
          <button onClick={() => handleDateShortcut('7d')} className={pillClass('7d')}>
            7 dias
          </button>
          <button onClick={() => handleDateShortcut('14d')} className={pillClass('14d')}>
            14 dias
          </button>
          <button onClick={() => handleDateShortcut('30d')} className={pillClass('30d')}>
            30 dias
          </button>
          <button onClick={() => handleDateShortcut('90d')} className={pillClass('90d')}>
            90 dias
          </button>

          <div className={`flex items-center gap-1 px-2 ${dateRangeFilter === 'custom' ? 'bg-amber-500/10 rounded' : ''}`}>
            <input
              type="date"
              value={dateFrom}
              onChange={e => {
                setDateRangeFilter('custom');
                setDateFrom(e.target.value);
              }}
              className="text-xs bg-transparent text-foreground outline-none"
            />
            <span className="text-xs text-console-muted">até</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => {
                setDateRangeFilter('custom');
                setDateTo(e.target.value);
              }}
              className="text-xs bg-transparent text-foreground outline-none"
            />
          </div>
        </div>
      </div>

      {/* ============================================================
          2. Overview bar
          ============================================================ */}
      {globalSummary && !isLoading && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          <StatPill label="Contas analisadas" value={globalSummary.accounts.toString()} color="text-foreground" />
          <StatPill
            label="Saudáveis"
            value={globalSummary.healthDist.healthy.toString()}
            color="text-emerald-600 dark:text-emerald-400"
            dot="bg-emerald-500"
          />
          <StatPill
            label="Em atenção"
            value={globalSummary.healthDist.watch.toString()}
            color="text-amber-600 dark:text-amber-400"
            dot="bg-amber-500"
          />
          <StatPill
            label="Críticas"
            value={globalSummary.healthDist.critical.toString()}
            color="text-rose-600 dark:text-rose-400"
            dot="bg-rose-500"
          />
          <StatPill
            label="⏸ Pausar"
            value={globalSummary.verdictCount.pause.toString()}
            color="text-rose-700 dark:text-rose-400"
          />
          <StatPill
            label="👀 Observar"
            value={globalSummary.verdictCount.observe.toString()}
            color="text-amber-700 dark:text-amber-400"
          />
          <StatPill
            label="🛟 Resgatar"
            value={globalSummary.verdictCount.rescue.toString()}
            color="text-emerald-700 dark:text-emerald-400"
          />
          <StatPill
            label="Desperdício potencial"
            value={globalSummary.totalSavings > 0 ? formatBRL(globalSummary.totalSavings) : '—'}
            color="text-emerald-700 dark:text-emerald-400"
          />
        </div>
      )}

      {/* ============================================================
          3. Filtros secundários
          ============================================================ */}
      {diagnostics.length > 0 && (
        <div className="bg-console-surface border border-console-border rounded p-3 flex items-center gap-3 flex-wrap">
          <span className="text-xs text-console-muted font-semibold">Filtro de criativos:</span>
          <CategoryChip active={categoryFilter === 'all'} onClick={() => setCategoryFilter('all')} label="Todos" />
          {(Object.keys(CATEGORY_STYLE) as CreativeCategory[]).map(cat => (
            <CategoryChip
              key={cat}
              active={categoryFilter === cat}
              onClick={() => setCategoryFilter(cat)}
              label={`${CATEGORY_STYLE[cat].emoji} ${CATEGORY_STYLE[cat].label}`}
              style={CATEGORY_STYLE[cat]}
            />
          ))}
        </div>
      )}

      {/* ============================================================
          4. Erros / Loading / Empty
          ============================================================ */}
      {error && (
        <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded p-4 text-sm text-rose-700 dark:text-rose-400">
          <strong>Erro:</strong> {error}
        </div>
      )}
      {isLoading && (
        <div className="bg-console-surface border border-console-border rounded p-12 text-center text-console-muted text-sm">
          Analisando campanhas...
        </div>
      )}
      {!isLoading && diagnostics.length === 0 && !error && (
        <div className="bg-console-surface border border-console-border rounded p-12 text-center text-console-muted text-sm">
          Selecione uma campanha RedTrack e pelo menos uma conta Meta para começar.
        </div>
      )}

      {/* ============================================================
          5. Uma seção de diagnóstico por conta
          ============================================================ */}
      {!isLoading &&
        diagnostics.map(diag => {
          const isExpanded = expandedAccounts.has(diag.account_id);
          const hs = HEALTH_STYLE[diag.health];
          const filteredCreatives =
            categoryFilter === 'all'
              ? diag.creatives
              : diag.creatives.filter(c => c.category === categoryFilter);

          return (
            <div
              key={diag.account_id}
              className="bg-console-surface border border-console-border rounded overflow-hidden"
            >
              {/* Cabeçalho da conta */}
              <div
                onClick={() => toggleAccount(diag.account_id)}
                className="px-6 py-4 border-b border-console-border bg-console-surface cursor-pointer hover:bg-console-surface-2 transition-colors"
              >
                <div className="flex items-center gap-4 flex-wrap">
                  <div className={`w-6 h-6 flex items-center justify-center rounded bg-console-surface-2 text-console-muted transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-foreground truncate">{diag.account_name}</h3>
                      <span
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${hs.bg} ${hs.color}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${hs.dot}`} />
                        {hs.label}
                      </span>
                    </div>
                    <p className="text-[11px] text-console-muted mt-0.5">{diag.health_note}</p>
                  </div>

                  {/* Métricas resumidas */}
                  <div className="flex items-center gap-6 text-xs">
                    <InlineStat label="Gasto" value={formatBRL(diag.totals.cost)} color="text-rose-500 dark:text-rose-400" />
                    <InlineStat label="Receita" value={formatBRL(diag.totals.revenue)} color="text-foreground" />
                    <InlineStat
                      label="Lucro"
                      value={formatBRL(diag.totals.profit)}
                      color={diag.totals.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}
                    />
                    <InlineStat
                      label="ROAS"
                      value={diag.totals.roas > 0 ? diag.totals.roas.toFixed(2) + 'x' : '—'}
                      color={diag.totals.roas >= 1.5 ? 'text-emerald-600 dark:text-emerald-400' : diag.totals.roas >= 1 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}
                    />
                    <InlineStat
                      label="Vendas"
                      value={formatNum(diag.totals.conversions)}
                      color="text-foreground"
                    />
                    <InlineStat
                      label="Criativos"
                      value={`${diag.active_creatives_count}`}
                      color="text-foreground"
                    />
                  </div>
                </div>

                {/* Sumário de categorias */}
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  {(Object.keys(CATEGORY_STYLE) as CreativeCategory[]).map(cat => {
                    const count = diag.creatives.filter(c => c.category === cat).length;
                    if (count === 0) return null;
                    const s = CATEGORY_STYLE[cat];
                    return (
                      <span
                        key={cat}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border ${s.bg} ${s.color} ${s.border}`}
                      >
                        {s.emoji} {count} {s.label.toLowerCase()}
                      </span>
                    );
                  })}
                  {/* Veredictos de recuperação (apenas para criativos ruins) */}
                  {(() => {
                    const bad = diag.creatives.filter(c =>
                      ['zombie', 'loser', 'underperformer'].includes(c.category) && c.recovery,
                    );
                    if (bad.length === 0) return null;
                    return (['rescue', 'observe', 'pause'] as RecoveryVerdict[]).map(v => {
                      const count = bad.filter(c => c.recovery!.verdict === v).length;
                      if (count === 0) return null;
                      const vs = VERDICT_STYLE[v];
                      return (
                        <span
                          key={v}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border ${vs.bg} ${vs.color} ${vs.border}`}
                        >
                          {vs.emoji} {count} {vs.label.toLowerCase()}
                        </span>
                      );
                    });
                  })()}
                  <span className="text-[10px] text-console-muted ml-2">
                    Concentração top-3: {formatPct(diag.concentration_top3_pct)} do gasto
                  </span>
                </div>
              </div>

              {/* Conteúdo expandido */}
              {isExpanded && (
                <div className="p-6 space-y-6">
                  {/* Sugestões */}
                  <SectionSuggestions suggestions={diag.suggestions} accountName={diag.account_name} />

                  {/* Lista de criativos */}
                  <SectionCreatives creatives={filteredCreatives} activeFilter={categoryFilter} />
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}

// ============================================================
// Sub-componente: painel de sugestões
// ============================================================
function SectionSuggestions({ suggestions, accountName }: { suggestions: Suggestion[]; accountName: string }) {
  if (suggestions.length === 0) {
    return (
      <div className="border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 rounded p-4 text-sm text-emerald-800 dark:text-emerald-400">
        <strong>✅ Sem sugestões críticas para {accountName}.</strong> A conta opera de forma saudável no período
        selecionado. Continue monitorando fadiga de criativos e mantenha pipeline de testes aberto.
      </div>
    );
  }

  return (
    <div>
      <h4 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
        <span className="w-1 h-4 bg-amber-500 rounded-sm" />
        Sugestões priorizadas ({suggestions.length})
      </h4>
      <div className="space-y-2">
        {suggestions.map((s, i) => (
          <SuggestionCard key={i} suggestion={s} />
        ))}
      </div>
    </div>
  );
}

function SuggestionCard({ suggestion }: { suggestion: Suggestion }) {
  const p = PRIORITY_STYLE[suggestion.priority];
  const [dismissed, setDismissed] = useState(false);
  const [done, setDone] = useState(false);

  if (dismissed) return null;

  return (
    <div
      className={`rounded border p-4 transition-all ${done ? 'opacity-50 bg-console-surface-2 border-console-border' : `${p.bg} ${p.border}`}`}
    >
      <div className="flex items-start gap-3">
        <div className="text-2xl shrink-0 mt-0.5">{ACTION_EMOJI[suggestion.action]}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${p.bg} ${p.color} ${p.border}`}
            >
              {suggestion.priority} · {p.label}
            </span>
            <span className="text-[9px] uppercase tracking-wider text-console-muted font-semibold">
              {actionLabel(suggestion.action)}
            </span>
            {suggestion.estimated_daily_brl !== undefined && suggestion.estimated_daily_brl < 0 && (
              <span className="text-[10px] text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 rounded font-semibold">
                Economiza {formatBRL(Math.abs(suggestion.estimated_daily_brl))}/período
              </span>
            )}
          </div>
          <h5 className={`text-sm font-bold ${done ? 'text-console-muted line-through' : 'text-foreground'}`}>
            {suggestion.title}
          </h5>
          <p className="text-xs text-foreground mt-1 leading-relaxed">{suggestion.detail}</p>
          <div className="mt-2 flex items-start gap-1.5 text-[11px] text-console-muted">
            <svg
              className="w-3.5 h-3.5 shrink-0 mt-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span>
              <strong className="text-foreground">Motivo:</strong> {suggestion.reason}
            </span>
          </div>
          <div className="mt-1 flex items-start gap-1.5 text-[11px] text-console-muted">
            <svg
              className="w-3.5 h-3.5 shrink-0 mt-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
              />
            </svg>
            <span>
              <strong className="text-foreground">Impacto:</strong> {suggestion.impact}
            </span>
          </div>
          {suggestion.targets.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {suggestion.targets.slice(0, 8).map((t, i) => (
                <span
                  key={i}
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-console-surface border border-console-border text-console-muted"
                >
                  {t}
                </span>
              ))}
              {suggestion.targets.length > 8 && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] text-console-muted">
                  +{suggestion.targets.length - 8}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          <button
            onClick={() => setDone(!done)}
            title={done ? 'Marcar como pendente' : 'Marcar como feita'}
            className={`p-1.5 rounded-md text-xs transition-colors ${done ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400' : 'text-console-muted hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40'}`}
          >
            ✓
          </button>
          <button
            onClick={() => setDismissed(true)}
            title="Descartar sugestão"
            className="p-1.5 rounded-md text-xs text-console-muted hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

function actionLabel(a: Suggestion['action']): string {
  switch (a) {
    case 'pause':
      return 'Pausar conjuntos';
    case 'duplicate':
      return 'Duplicar em novos conjuntos';
    case 'new_test':
      return 'Lançar novos testes';
    case 'consolidate':
      return 'Consolidar estrutura';
    case 'investigate':
      return 'Investigar';
  }
}

// ============================================================
// Sub-componente: lista de criativos categorizados
// ============================================================
function SectionCreatives({
  creatives,
  activeFilter,
}: {
  creatives: CreativeDiagnostic[];
  activeFilter: CreativeCategory | 'all';
}) {
  if (creatives.length === 0) {
    return (
      <div>
        <h4 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
          <span className="w-1 h-4 bg-amber-500 rounded-sm" />
          Criativos
        </h4>
        <div className="text-xs text-console-muted text-center py-6">
          Nenhum criativo nesta categoria para esta conta.
        </div>
      </div>
    );
  }

  // Ordenar por prioridade: zombies/losers primeiro, depois winners/promises, depois stable
  const order: Record<CreativeCategory, number> = {
    zombie: 0,
    loser: 1,
    underperformer: 2,
    winner: 3,
    promise: 4,
    stable: 5,
  };
  const sorted = [...creatives].sort((a, b) => {
    if (order[a.category] !== order[b.category]) return order[a.category] - order[b.category];
    // Dentro da categoria, ordenar por cost desc
    return b.cost - a.cost;
  });

  return (
    <div>
      <h4 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
        <span className="w-1 h-4 bg-amber-500 rounded-sm" />
        Criativos {activeFilter === 'all' ? `(${creatives.length})` : `· ${CATEGORY_STYLE[activeFilter].label}`}
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-console-surface-2 text-console-muted text-[10px] uppercase tracking-wider">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Categoria</th>
              <th className="px-3 py-2 text-left font-semibold">Criativo (rt_ad)</th>
              <th className="px-3 py-2 text-right font-semibold">Gasto</th>
              <th className="px-3 py-2 text-right font-semibold">ROAS</th>
              <th className="px-3 py-2 text-right font-semibold">Vendas</th>
              <th className="px-3 py-2 text-right font-semibold">CPA</th>
              <th className="px-3 py-2 text-right font-semibold">CTR</th>
              <th className="px-3 py-2 text-right font-semibold">CPM</th>
              <th className="px-3 py-2 text-right font-semibold">Conj.</th>
              <th className="px-3 py-2 text-left font-semibold">Diagnóstico / Sinais de Recuperação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-console-border">
            {sorted.map((c, i) => (
              <CreativeRow key={i} creative={c} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// Linha da tabela de criativos — inclui veredicto de recuperação + badges
// ============================================================
function CreativeRow({ creative: c }: { creative: CreativeDiagnostic }) {
  const [expanded, setExpanded] = useState(false);
  const s = CATEGORY_STYLE[c.category];
  const profitColor = c.profit >= 0 ? 'text-emerald-600' : 'text-rose-600';
  const roasColor = c.roas >= 1.5 ? 'text-emerald-600' : c.roas >= 1 ? 'text-amber-600' : 'text-rose-600';

  const isBad = ['zombie', 'loser', 'underperformer'].includes(c.category);
  const rec = c.recovery;
  const verdict = rec && isBad ? VERDICT_STYLE[rec.verdict] : null;

  return (
    <>
      <tr
        className={`hover:bg-console-surface-2 transition-colors border-l-2 border-transparent hover:border-amber-500 ${expanded ? 'bg-amber-500/5' : ''} ${rec && rec.signals.length > 0 ? 'cursor-pointer' : ''}`}
        onClick={() => rec && rec.signals.length > 0 && setExpanded(e => !e)}
      >
        <td className="px-3 py-2.5">
          <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${s.bg} ${s.color} ${s.border}`}
          >
            {s.emoji} {s.label}
          </span>
          {verdict && rec && (
            <span
              className={`ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${verdict.bg} ${verdict.color} ${verdict.border}`}
              title={rec.verdict_reason}
            >
              {verdict.emoji} {verdict.label}
            </span>
          )}
        </td>
        <td className="px-3 py-2.5 font-mono font-semibold text-foreground">
          {c.rt_ad}
          {c.concentrated && c.category === 'winner' && (
            <span className="ml-1.5 text-[9px] text-sky-600 dark:text-sky-400 font-semibold">· expansível</span>
          )}
        </td>
        <td className="px-3 py-2.5 text-right font-mono text-rose-500">{formatBRL(c.cost)}</td>
        <td className={`px-3 py-2.5 text-right font-mono font-bold ${roasColor}`}>
          {c.roas > 0 ? c.roas.toFixed(2) + 'x' : '—'}
        </td>
        <td className="px-3 py-2.5 text-right font-mono text-foreground">{formatNum(c.conversions)}</td>
        <td className="px-3 py-2.5 text-right font-mono text-console-muted">
          {c.cpa > 0 ? formatBRL(c.cpa) : '—'}
        </td>
        <td className="px-3 py-2.5 text-right font-mono text-console-muted">
          {c.ctr > 0 ? c.ctr.toFixed(2) + '%' : '—'}
        </td>
        <td className="px-3 py-2.5 text-right font-mono text-console-muted">
          {c.cpm > 0 ? formatBRL(c.cpm) : '—'}
        </td>
        <td className="px-3 py-2.5 text-right font-mono text-foreground">{c.meta_campaigns_count}</td>
        <td className="px-3 py-2.5 text-console-muted text-[11px] max-w-[360px]">
          <div>{c.reason}</div>
          {rec && rec.signals.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1 items-center">
              {rec.signals.map((sig, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-console-surface border border-console-border text-console-muted"
                  title={sig.detail}
                >
                  {SIGNAL_EMOJI[sig.type]} {sig.label}
                </span>
              ))}
              <button
                className="ml-1 text-[10px] text-amber-400 hover:text-amber-300 font-semibold underline-offset-2 hover:underline"
                onClick={e => {
                  e.stopPropagation();
                  setExpanded(x => !x);
                }}
              >
                {expanded ? 'ocultar detalhes' : 'ver detalhes'}
              </button>
            </div>
          )}
          {rec && rec.signals.length === 0 && isBad && (
            <div className="mt-1 text-[10px] text-rose-600 dark:text-rose-400 italic">
              Sem sinais de recuperação — pausa recomendada.
            </div>
          )}
        </td>
      </tr>
      {expanded && rec && rec.signals.length > 0 && (
        <tr className="bg-amber-500/5">
          <td colSpan={10} className="px-8 py-4 border-b border-console-border">
            <div className="max-w-3xl">
              <div className="flex items-center gap-2 mb-2">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border ${verdict!.bg} ${verdict!.color} ${verdict!.border}`}>
                  {verdict!.emoji} Veredicto: {verdict!.label}
                </span>
                <span className="text-[11px] text-console-muted">{rec.verdict_reason}</span>
              </div>
              <div className="space-y-1.5">
                {rec.signals.map((sig, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px]">
                    <span className="shrink-0 text-base leading-none mt-0.5">{SIGNAL_EMOJI[sig.type]}</span>
                    <div>
                      <strong className="text-foreground">{sig.label}:</strong>{' '}
                      <span className="text-console-muted">{sig.detail}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ============================================================
// UI bits
// ============================================================
function StatPill({
  label,
  value,
  color,
  dot,
}: {
  label: string;
  value: string;
  color: string;
  dot?: string;
}) {
  return (
    <div className="bg-console-surface border border-console-border rounded p-3">
      <div className="flex items-center gap-1.5 mb-1">
        {dot && <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />}
        <span className="text-[9px] text-console-muted font-bold tracking-wider uppercase">{label}</span>
      </div>
      <span className={`text-lg font-bold ${color}`}>{value}</span>
    </div>
  );
}

function InlineStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] text-console-muted font-bold uppercase tracking-wider">{label}</span>
      <span className={`font-mono font-semibold ${color}`}>{value}</span>
    </div>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
  style,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  style?: { color: string; bg: string; border: string };
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors ${
        active
          ? style
            ? `${style.bg} ${style.color} ${style.border}`
            : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
          : 'bg-console-surface text-console-muted border-console-border hover:bg-console-surface-2'
      }`}
    >
      {label}
    </button>
  );
}
