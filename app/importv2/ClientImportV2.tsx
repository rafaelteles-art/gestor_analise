'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { todayStr, daysAgoStr } from '@/lib/timezone';
import Select from 'react-select';
import { darkAwareSelectStyles } from '@/app/lib/reactSelectStyles';
import CampaignHoverPopup from '../import/CampaignHoverPopup';
import { preloadHistoryBatch } from '../import/hoverCache';
import OfferSelector from '../components/OfferSelector';
import { AccountStatusBadge } from '@/app/lib/accountStatus';

interface AdAccount {
  account_id: string;
  account_name: string;
  bm_id: string;
  bm_name: string;
  account_status?: string | null;
}

interface RtCampaign {
  id: string;
  campaign_id: string;
  campaign_name: string;
}

interface ClientImportV2Props {
  dbAccounts: AdAccount[];
  rtCampaigns: RtCampaign[];
  offers: { id: number; nome: string }[];
  currentOferta: number | null;
}


export default function ClientImportV2({ dbAccounts, rtCampaigns, offers, currentOferta }: ClientImportV2Props) {
  const sortedAccounts = [...dbAccounts].sort((a, b) => a.account_name.localeCompare(b.account_name));
  const sortedRtCampaigns = [...rtCampaigns].sort((a, b) => a.campaign_name.localeCompare(b.campaign_name));

  // Stable signatures of the offer-scoped sets. When the offer changes (URL
  // navigation re-renders this component with new props), these change and the
  // initialization effect re-applies the default-to-all selection for the scope.
  const accountScopeKey = sortedAccounts.map(a => a.account_id).join(',');
  const rtScopeKey = sortedRtCampaigns.map(c => c.campaign_id).join(',');

  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [selectedRtCampaignId, setSelectedRtCampaignId] = useState<string>('');

  const [dateRangeFilter, setDateRangeFilter] = useState<'today'|'yesterday'|'7d'|'14d'|'30d'|'custom'>('today');
  const [dateFrom, setDateFrom] = useState(todayStr());
  const [dateTo, setDateTo] = useState(todayStr());

  const [isImporting, setIsImporting] = useState(false);
  const [isSyncingToday, setIsSyncingToday] = useState(false);
  const [importResults, setImportResults] = useState<any[]>([]);
  const [rtTotals, setRtTotals] = useState<any>(null);
  const [perAccountTotals, setPerAccountTotals] = useState<any[]>([]);
  const [exchangeRate, setExchangeRate] = useState<number | null>(null);
  const [tableSearch, setTableSearch] = useState('');

  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);

  const [hoverTimeoutId, setHoverTimeoutId] = useState<any>(null);
  const [hoverData, setHoverData] = useState<{ x: number, y: number, group: any, accountId: string } | null>(null);

  const handleMouseEnterRow = (e: React.MouseEvent, group: any, accId: string) => {
    const x = e.clientX;
    const y = e.clientY;
    if (hoverTimeoutId) clearTimeout(hoverTimeoutId);
    const tid = setTimeout(() => {
        setHoverData({ x, y, group, accountId: accId });
    }, 400);
    setHoverTimeoutId(tid);
  };

  const handleMouseLeaveRow = () => {
    if (hoverTimeoutId) clearTimeout(hoverTimeoutId);
    const tid = setTimeout(() => setHoverData(null), 300);
    setHoverTimeoutId(tid);
  };

  const cancelMouseLeave = () => {
    if (hoverTimeoutId) clearTimeout(hoverTimeoutId);
  };

  // Mount-only restore: date range and sort initialize ONCE.
  // These must NOT reset when the user switches offer (props change), so they
  // live in an effect with an empty dep array — independent of the offer scope.
  useEffect(() => {
    let initialDateRange = 'today';
    let initialDateFrom = todayStr();
    let initialDateTo = todayStr();
    let initialSortConfig = null;

    try {
        const savedStr = localStorage.getItem('dopscale_prefs');
        if (savedStr) {
            const saved = JSON.parse(savedStr);
            if (saved.dateRange) {
                initialDateRange = saved.dateRange;
                if (saved.dateRange === 'custom') {
                    initialDateFrom = saved.dateFrom || initialDateFrom;
                    initialDateTo = saved.dateTo || initialDateTo;
                } else {
                    if (saved.dateRange === 'yesterday') { initialDateFrom = daysAgoStr(1); initialDateTo = daysAgoStr(1); }
                    else if (saved.dateRange === '7d') { initialDateFrom = daysAgoStr(6); }
                    else if (saved.dateRange === '14d') { initialDateFrom = daysAgoStr(13); }
                    else if (saved.dateRange === '30d') { initialDateFrom = daysAgoStr(29); }
                }
            }
            if (saved.sortConfig !== undefined) {
                initialSortConfig = saved.sortConfig;
            }
        }
    } catch(e) {}

    setDateRangeFilter(initialDateRange as any);
    setDateFrom(initialDateFrom);
    setDateTo(initialDateTo);
    if (initialSortConfig) setSortConfig(initialSortConfig);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scope restore: re-applies the account + RT-campaign default-to-all selection
  // whenever the offer-scoped set changes (offer switch via navigation). A fresh
  // load with a given ?oferta must show all that offer's accounts.
  useEffect(() => {
    // Default-to-ALL within the offer scope: with no manual action, every
    // offer-scoped account is included so the user needn't pick anything.
    let initialAccountIds: string[] = sortedAccounts.map(a => a.account_id);
    // RT single-select default semantics: first offer-scoped campaign (or '').
    let initialRtCampaignId = sortedRtCampaigns.length > 0 ? sortedRtCampaigns[0].campaign_id : '';

    try {
        const savedStr = localStorage.getItem('dopscale_prefs');
        if (savedStr) {
            const saved = JSON.parse(savedStr);
            // Intersect any stored account ids with the current offer-scoped set.
            // If the intersection is empty (new offer / stale ids), fall back to
            // ALL offer-scoped accounts (the default-to-all behavior above).
            if (Array.isArray(saved.accountIds)) {
                const valid = saved.accountIds.filter((id: string) =>
                    sortedAccounts.some(a => a.account_id === id)
                );
                if (valid.length > 0) initialAccountIds = valid;
            } else if (saved.accountId && sortedAccounts.some(a => a.account_id === saved.accountId)) {
                initialAccountIds = [saved.accountId];
            }
            // Only restore the stored RT campaign if it exists in the offer-scoped
            // list; otherwise keep the default (first campaign / '').
            if (saved.rtCampaignId && sortedRtCampaigns.some(c => c.campaign_id === saved.rtCampaignId)) {
                initialRtCampaignId = saved.rtCampaignId;
            }
        }
    } catch(e) {}

    setSelectedAccountIds(initialAccountIds);
    setSelectedRtCampaignId(initialRtCampaignId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountScopeKey, rtScopeKey]);


  useEffect(() => {
    if (selectedAccountIds.length === 0 || !selectedRtCampaignId) return;
    try {
        localStorage.setItem('dopscale_prefs', JSON.stringify({
            accountIds: selectedAccountIds,
            rtCampaignId: selectedRtCampaignId,
            dateRange: dateRangeFilter,
            dateFrom: dateRangeFilter === 'custom' ? dateFrom : null,
            dateTo: dateRangeFilter === 'custom' ? dateTo : null,
            sortConfig: sortConfig
        }));
    } catch(e) {}
  }, [selectedAccountIds, selectedRtCampaignId, dateRangeFilter, dateFrom, dateTo, sortConfig]);

  const handleDateShortcut = (range: 'today'|'yesterday'|'7d'|'14d'|'30d') => {
    setDateRangeFilter(range);
    let from = todayStr();
    let to = todayStr();
    if (range === 'yesterday') {
      from = daysAgoStr(1);
      to = daysAgoStr(1);
    } else if (range === '7d') {
      from = daysAgoStr(6);
    } else if (range === '14d') {
      from = daysAgoStr(13);
    } else if (range === '30d') {
      from = daysAgoStr(29);
    }
    setDateFrom(from);
    setDateTo(to);
  };

  const handleCustomDateChange = (type: 'from'|'to', val: string) => {
    setDateRangeFilter('custom');
    if (type === 'from') setDateFrom(val);
    else setDateTo(val);
  };

  const handleImport = async () => {
    if (selectedAccountIds.length === 0 || !selectedRtCampaignId || !dateFrom || !dateTo) return;

    setIsImporting(true);
    try {
      const accs = sortedAccounts.filter(a => selectedAccountIds.includes(a.account_id));
      const camp = sortedRtCampaigns.find(c => c.campaign_id === selectedRtCampaignId);

      const response = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dateFrom,
          dateTo,
          accounts: accs,
          rtCampaigns: camp ? [camp] : [],
          filterRegex: '',
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setImportResults(data.data || []);
      setRtTotals(data.rt_totals || null);
      setPerAccountTotals(data.per_account_totals || []);
      setExchangeRate(data.exchange_rate ?? null);
    } catch (error: any) {
      console.error(error);
      alert("Erro ao cruzar dados: " + error.message);
    } finally {
      setIsImporting(false);
    }
  };

  const handleSyncToday = async () => {
    if (selectedAccountIds.length === 0 || !selectedRtCampaignId) return;
    setIsSyncingToday(true);
    try {
      const results = await Promise.all(selectedAccountIds.map(async (accId) => {
        const response = await fetch('/api/import/sync-today', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId: accId, rtCampaignId: selectedRtCampaignId }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(`${accId}: ${data.error}`);
        return data;
      }));
      console.log(`[SyncToday] ${results.length} contas sincronizadas`);
      await handleImport();
    } catch (error: any) {
      console.error(error);
      alert("Erro ao sincronizar hoje: " + error.message);
    } finally {
      setIsSyncingToday(false);
    }
  };

  useEffect(() => {
    handleImport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountIds, selectedRtCampaignId, dateFrom, dateTo]);

  // Lista plana de campanhas Meta por conta (sem agrupamento por rt_ad).
  const campaignsByAccount = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const accId of selectedAccountIds) map[accId] = [];
    for (const g of importResults) {
      for (const mc of g.meta_campaigns || []) {
        if (!map[mc.account_id]) continue;
        map[mc.account_id].push(mc);
      }
    }
    return map;
  }, [importResults, selectedAccountIds]);

  // Pré-carrega o histórico de hover usando o campaign_name como chave.
  // O endpoint /api/history filtra Meta por regex contendo o nome — para nomes
  // completos isso isola a campanha individual.
  useEffect(() => {
    if (selectedAccountIds.length === 0 || !selectedRtCampaignId) return;
    for (const accId of selectedAccountIds) {
      const names = (campaignsByAccount[accId] || []).map((mc: any) => mc.campaign_name).filter(Boolean);
      if (names.length > 0) preloadHistoryBatch(accId, selectedRtCampaignId, names);
    }
  }, [campaignsByAccount, selectedAccountIds, selectedRtCampaignId]);

  const formatCurrency = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const formatPercent = (v: number) => v.toFixed(2) + '%';
  const formatNumber = (v: number) => v.toLocaleString('pt-BR');

  const getPillClass = (range: string) => {
    const base = "px-4 py-1.5 text-xs font-semibold rounded-md transition-colors ";
    return dateRangeFilter === range
        ? base + "bg-indigo-600 text-white"
        : base + "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 border border-transparent";
  };

  const filterAndSortCampaigns = (campaigns: any[]) => {
    const filtered = campaigns.filter(mc => {
      if (!tableSearch) return true;
      return mc.campaign_name.toLowerCase().includes(tableSearch.toLowerCase());
    });
    return [...filtered].sort((a, b) => {
      if (!sortConfig) return 0;
      const { key, direction } = sortConfig;
      let valA = a[key] ?? 0;
      let valB = b[key] ?? 0;
      if (key === 'campaign_name') {
        valA = String(valA).toLowerCase();
        valB = String(valB).toLowerCase();
      }
      if (valA < valB) return direction === 'asc' ? -1 : 1;
      if (valA > valB) return direction === 'asc' ? 1 : -1;
      return 0;
    });
  };

  const requestSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'desc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') {
        direction = 'asc';
    }
    setSortConfig({ key, direction });
  };

  const TableHeader = ({ label, sortKey, alignLeft = false, colSpan = 1 }: any) => {
      const isActive = sortConfig?.key === sortKey;
      return (
        <div
            className={`px-4 py-3 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors flex items-center gap-1.5 select-none ${alignLeft ? 'justify-start' : 'justify-end'} ${colSpan > 1 ? 'col-span-2 px-6' : ''}`}
            onClick={() => requestSort(sortKey)}
        >
            {label}
            <span className={`text-[9px] ${isActive ? 'text-indigo-600' : 'text-gray-300 dark:text-gray-600'}`}>
                {isActive ? (sortConfig?.direction === 'asc' ? '▲' : '▼') : '↕'}
            </span>
        </div>
      );
  };

  return (
    <div className="flex flex-col gap-6">

      {/* 1. Header Controls */}
      <div className="flex flex-wrap items-center gap-3 bg-white dark:bg-gray-900 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800">

        <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[220px]">
                <Select
                    instanceId="select-rt-campaign-v2"
                    options={sortedRtCampaigns.map(c => ({ value: c.campaign_id, label: c.campaign_name }))}
                    value={sortedRtCampaigns.map(c => ({ value: c.campaign_id, label: c.campaign_name })).find(o => o.value === selectedRtCampaignId) || null}
                    onChange={(selected: any) => setSelectedRtCampaignId(selected?.value || '')}
                    placeholder="Selecione RedTrack"
                    className="text-sm rounded-lg"
                    styles={darkAwareSelectStyles}
                />
            </div>

            <div className="min-w-[260px]">
                <Select
                    instanceId="select-meta-account-v2"
                    isMulti
                    closeMenuOnSelect={false}
                    hideSelectedOptions={false}
                    options={[
                        { value: '__all__', label: `Selecionar todas (${sortedAccounts.length})`, status: null },
                        ...sortedAccounts.map(a => ({ value: a.account_id, label: a.account_name, status: a.account_status ?? null })),
                    ]}
                    value={sortedAccounts
                        .filter(a => selectedAccountIds.includes(a.account_id))
                        .map(a => ({ value: a.account_id, label: a.account_name, status: a.account_status ?? null }))}
                    onChange={(selected: any) => {
                        const opts = selected || [];
                        if (opts.some((o: any) => o.value === '__all__')) {
                            setSelectedAccountIds(sortedAccounts.map(a => a.account_id));
                        } else {
                            setSelectedAccountIds(opts.map((o: any) => o.value));
                        }
                    }}
                    formatOptionLabel={(opt: any, meta: any) =>
                        meta.context === 'menu' ? (
                            <div className="flex items-center justify-between gap-2">
                                <span>{opt.label}</span>
                                <AccountStatusBadge status={opt.status} />
                            </div>
                        ) : opt.label
                    }
                    placeholder="Selecione contas Meta"
                    className="text-sm rounded-lg"
                    styles={darkAwareSelectStyles}
                />
            </div>

            <div className="flex items-center border-l border-gray-200 dark:border-gray-700 pl-3">
                <OfferSelector offers={offers} current={currentOferta} />
            </div>

            <button
                onClick={() => handleImport()}
                disabled={isImporting}
                title="Carregar dados do banco de dados"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-indigo-600 hover:border-indigo-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
                <svg className={`h-3.5 w-3.5 ${isImporting ? 'animate-spin' : ''}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {isImporting ? 'Carregando...' : 'Atualizar'}
            </button>

            <button
                onClick={() => handleImport()}
                disabled={isImporting || isSyncingToday}
                title="Recarregar dados do banco (para sincronizar com Meta e RedTrack, use Configurações)"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-amber-200 dark:border-amber-800 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40 hover:border-amber-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
                <svg className={`h-3.5 w-3.5 ${isImporting ? 'animate-spin' : ''}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                Recarregar
            </button>

            <button
                onClick={handleSyncToday}
                disabled={isImporting || isSyncingToday}
                title="Buscar dados de hoje via API (Meta + RedTrack) e atualizar o banco"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-emerald-200 dark:border-emerald-800 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 hover:border-emerald-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
                <svg className={`h-3.5 w-3.5 ${isSyncingToday ? 'animate-spin' : ''}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m8.66-13l-.87.5M4.21 15.5l-.87.5M20.66 15.5l-.87-.5M4.21 8.5l-.87-.5M21 12h-1M4 12H3" />
                    <circle cx="12" cy="12" r="4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {isSyncingToday ? 'Sincronizando...' : 'Hoje (API)'}
            </button>
        </div>

        <div className="flex flex-wrap items-center gap-1 border border-gray-200 dark:border-gray-700 rounded-lg p-1 bg-white dark:bg-gray-900">
            <button onClick={() => handleDateShortcut('today')} className={getPillClass('today')}>Hoje</button>
            <button onClick={() => handleDateShortcut('yesterday')} className={getPillClass('yesterday')}>Ontem</button>
            <button onClick={() => handleDateShortcut('7d')} className={getPillClass('7d')}>7 dias</button>
            <button onClick={() => handleDateShortcut('14d')} className={getPillClass('14d')}>14 dias</button>
            <button onClick={() => handleDateShortcut('30d')} className={getPillClass('30d')}>30 dias</button>

            <div className={`flex items-center gap-1 px-2 ${dateRangeFilter === 'custom' ? 'bg-indigo-50 dark:bg-indigo-950/40 rounded' : ''}`}>
                <input type="date" value={dateFrom} onChange={e => handleCustomDateChange('from', e.target.value)} className="w-[92px] min-w-0 text-xs bg-transparent text-gray-700 dark:text-gray-300 outline-none" />
                <span className="text-xs text-gray-400 dark:text-gray-500">até</span>
                <input type="date" value={dateTo} onChange={e => handleCustomDateChange('to', e.target.value)} className="w-[92px] min-w-0 text-xs bg-transparent text-gray-700 dark:text-gray-300 outline-none" />
            </div>
        </div>

      </div>

      {/* 2. Top Summary Cards */}
      {rtTotals && (
        <div className="flex w-full gap-4 overflow-x-auto pb-2">
            {[
                { title: 'RECEITA', value: formatCurrency(rtTotals.revenue), color: 'text-gray-800 dark:text-gray-100' },
                { title: 'GASTO', value: formatCurrency(rtTotals.cost), color: 'text-rose-500' },
                { title: 'LUCRO', value: formatCurrency(rtTotals.profit), color: rtTotals.profit >= 0 ? 'text-emerald-500' : 'text-rose-500' },
                { title: 'ROAS', value: rtTotals.roas > 0 ? rtTotals.roas.toFixed(2) + 'x' : '0.00x', color: rtTotals.roas >= 1 ? 'text-amber-500' : 'text-gray-500 dark:text-gray-400' },
                { title: 'IC', value: formatNumber(rtTotals.ic || 0), color: 'text-sky-500' },
                { title: 'VENDAS', value: rtTotals.conversions.toString(), color: 'text-gray-800 dark:text-gray-100' },
                { title: 'CPA', value: formatCurrency(rtTotals.cpa), color: 'text-gray-800 dark:text-gray-100' },
                { title: 'RET. PITCH', value: rtTotals.vturb_over_pitch_rate != null ? formatPercent(rtTotals.vturb_over_pitch_rate) : '—', color: 'text-fuchsia-500' },
                { title: 'CONV. VTURB', value: rtTotals.vturb_conversion_rate != null ? formatPercent(rtTotals.vturb_conversion_rate) : '—', color: 'text-fuchsia-500' },
            ].map((card, i) => (
                <div key={i} className="flex-1 bg-white dark:bg-gray-900 min-w-[150px] p-5 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm flex flex-col justify-center">
                    <h3 className="text-[10px] text-gray-400 dark:text-gray-500 font-bold tracking-wider mb-2 uppercase">{card.title}</h3>
                    <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
                </div>
            ))}
            {exchangeRate !== null && (
              <div className="flex flex-col justify-center self-stretch px-4 py-3 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm whitespace-nowrap">
                <h3 className="text-[10px] text-gray-400 dark:text-gray-500 font-bold tracking-wider mb-2 uppercase">USD/BRL</h3>
                <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">R$ {exchangeRate.toFixed(4).replace('.', ',')}</p>
              </div>
            )}
        </div>
      )}

      {/* 3. Uma tabela por conta selecionada — campanhas Meta sem agrupamento por rt_ad */}
      {importResults.length === 0 && !isImporting && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm p-12 text-center text-gray-400 dark:text-gray-500 text-sm">
            Nenhum resultado encontrado para o período selecionado.
        </div>
      )}

      {selectedAccountIds.map((accId) => {
        const acc = sortedAccounts.find(a => a.account_id === accId);
        const accName = acc?.account_name ?? accId;
        const accStatus = acc?.account_status ?? null;
        const accTotals = perAccountTotals.find((t: any) => t.account_id === accId);
        const accCampaigns = campaignsByAccount[accId] || [];
        const accSorted = filterAndSortCampaigns(accCampaigns);
        const accProfit = accTotals?.profit ?? 0;
        const accRoas = accTotals?.roas ?? 0;
        const accProfitColor = accProfit >= 0 ? 'text-emerald-500' : 'text-rose-500';
        const accRoasColor = accRoas >= 1 ? 'text-emerald-500' : accRoas > 0 ? 'text-amber-500' : 'text-gray-400 dark:text-gray-500';

        return (
        <div key={accId} className="bg-white dark:bg-gray-900 border text-gray-800 dark:text-gray-100 border-gray-200 dark:border-gray-700 rounded-xl shadow-sm overflow-hidden flex flex-col">

          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r from-indigo-50/40 dark:from-indigo-950/40 to-transparent flex flex-wrap items-center gap-x-8 gap-y-2">
            <div className="flex items-center gap-2 min-w-[200px]">
              <div className="w-1.5 h-6 bg-indigo-500 rounded-sm" />
              <div>
                <div className="text-[10px] text-gray-400 dark:text-gray-500 font-bold tracking-wider uppercase">Conta</div>
                <div className="flex items-center gap-2">
                  <div className="text-sm font-bold text-gray-800 dark:text-gray-100 truncate max-w-[280px]" title={accName}>{accName}</div>
                  <AccountStatusBadge status={accStatus} />
                </div>
              </div>
            </div>
            {accTotals && (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs ml-auto">
                <div className="flex flex-col">
                  <span className="text-[9px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-wider">Gasto</span>
                  <span className="font-mono font-semibold text-rose-500">{formatCurrency(accTotals.cost)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-wider">Receita</span>
                  <span className="font-mono font-semibold text-gray-800 dark:text-gray-100">{formatCurrency(accTotals.revenue)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-wider">Lucro</span>
                  <span className={`font-mono font-bold ${accProfitColor}`}>{formatCurrency(accTotals.profit)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-wider">ROAS</span>
                  <span className={`font-mono font-bold ${accRoasColor}`}>{accTotals.roas > 0 ? accTotals.roas.toFixed(2)+'x' : '—'}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-wider">IC</span>
                  <span className="font-mono font-semibold text-sky-500">{formatNumber(accTotals.ic || 0)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-wider">Vendas</span>
                  <span className="font-mono font-semibold text-gray-800 dark:text-gray-100">{formatNumber(accTotals.conversions)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-wider">CPA</span>
                  <span className="font-mono font-semibold text-gray-800 dark:text-gray-100">{accTotals.cpa > 0 ? formatCurrency(accTotals.cpa) : '—'}</span>
                </div>
              </div>
            )}
          </div>

          <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-4 bg-white dark:bg-gray-900">
              <span className="text-xs text-gray-400 dark:text-gray-500 font-semibold">{accSorted.length} campanhas</span>
              <div className="relative">
                  <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  <input
                      type="text"
                      placeholder="Filtrar campanha..."
                      className="pl-9 pr-4 py-1.5 border border-gray-200 dark:border-gray-700 rounded-md text-xs w-64 outline-none focus:border-indigo-500 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
                      value={tableSearch}
                      onChange={e => setTableSearch(e.target.value)}
                  />
              </div>
          </div>

          <div className="grid grid-cols-[repeat(13,minmax(0,1fr))] bg-gray-50 dark:bg-gray-800 text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">
            <TableHeader label="Campanha Facebook" sortKey="campaign_name" alignLeft={true} colSpan={2} />
            <TableHeader label="Gasto" sortKey="spend" />
            <TableHeader label="Receita" sortKey="revenue" />
            <TableHeader label="IC" sortKey="ic" />
            <TableHeader label="Vendas" sortKey="conversions" />
            <TableHeader label="CPA" sortKey="cpa" />
            <TableHeader label="Lucro" sortKey="profit" />
            <TableHeader label="ROAS" sortKey="roas" />
            <TableHeader label="CPM" sortKey="cpm" />
            <TableHeader label="CTR" sortKey="ctr" />
            <TableHeader label="Ret. Pitch" sortKey="vturb_over_pitch_rate" />
            <TableHeader label="Conv. VT" sortKey="vturb_conversion_rate" />
          </div>

          {accSorted.length === 0 && (
            <div className="p-8 text-center text-gray-400 dark:text-gray-500 text-xs">
              Sem campanhas desta conta no período.
            </div>
          )}

          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {accSorted.map((mc: any, idx: number) => {
                const profitColor = mc.profit >= 0 ? 'text-emerald-500' : 'text-rose-500';
                const roasColor = mc.roas >= 1 ? 'text-emerald-500' : mc.roas > 0 ? 'text-amber-500' : 'text-gray-400 dark:text-gray-500';

                // Constrói um group sintético com uma única campanha para o popup de hover.
                // O popup usa rt_ad para fetch de histórico — passando o nome completo
                // o regex de /api/history isola essa campanha individual.
                const hoverGroup = {
                  rt_ad: mc.campaign_name,
                  cost: mc.spend,
                  meta_campaigns: [mc],
                };

                return (
                <div
                  key={mc.campaign_id + '-' + idx}
                  className="grid grid-cols-[repeat(13,minmax(0,1fr))] text-xs hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group relative cursor-help"
                  onMouseEnter={(e) => handleMouseEnterRow(e, hoverGroup, accId)}
                  onMouseLeave={handleMouseLeaveRow}
                >
                    <div className="col-span-2 px-6 py-3.5 flex items-center gap-3">
                        <span className="font-medium text-gray-700 dark:text-gray-300 break-words whitespace-normal leading-relaxed">
                            {mc.campaign_name}
                        </span>
                    </div>
                    <div className="px-4 py-3.5 text-right font-mono font-medium">{formatCurrency(mc.spend)}</div>
                    <div className="px-4 py-3.5 text-right font-mono font-medium">{mc.revenue > 0 ? formatCurrency(mc.revenue) : '—'}</div>
                    <div className="px-4 py-3.5 text-right font-mono font-semibold text-sky-500">{mc.ic > 0 ? mc.ic : '—'}</div>
                    <div className="px-4 py-3.5 text-right font-mono font-bold">{mc.conversions > 0 ? mc.conversions : '—'} <span className="text-gray-400 dark:text-gray-500 text-[10px] font-sans">v</span></div>
                    <div className="px-4 py-3.5 text-right font-mono font-medium">{mc.cpa > 0 ? formatCurrency(mc.cpa) : '—'}</div>
                    <div className={`px-4 py-3.5 text-right font-mono font-bold ${mc.revenue > 0 ? profitColor : 'text-gray-400 dark:text-gray-500'}`}>{mc.revenue > 0 ? formatCurrency(mc.profit) : '—'}</div>
                    <div className={`px-4 py-3.5 text-right font-mono font-bold ${mc.revenue > 0 ? roasColor : 'text-gray-400 dark:text-gray-500'}`}>{mc.roas > 0 ? mc.roas.toFixed(2)+'x' : '—'}</div>
                    <div className="px-4 py-3.5 text-right font-mono text-gray-500 dark:text-gray-400">{mc.cpm > 0 ? formatCurrency(mc.cpm) : '—'}</div>
                    <div className="px-4 py-3.5 text-right font-mono text-gray-500 dark:text-gray-400">{mc.ctr > 0 ? formatPercent(mc.ctr) : '—'}</div>
                    <div className="px-4 py-3.5 text-right font-mono text-fuchsia-500">{mc.vturb_over_pitch_rate != null ? formatPercent(mc.vturb_over_pitch_rate) : '—'}</div>
                    <div className="px-4 py-3.5 text-right font-mono text-fuchsia-500">{mc.vturb_conversion_rate != null ? formatPercent(mc.vturb_conversion_rate) : '—'}</div>
                </div>
                );
            })}
          </div>
        </div>
        );
      })}

    {hoverData && (
        <CampaignHoverPopup
           x={hoverData.x}
           y={hoverData.y}
           groupData={hoverData.group}
           accountId={hoverData.accountId}
           rtCampaignId={selectedRtCampaignId}
           diagnostic={null}
           onMouseEnter={cancelMouseLeave}
           onMouseLeave={handleMouseLeaveRow}
        />
    )}

    </div>
  );
}
