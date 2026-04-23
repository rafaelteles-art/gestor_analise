'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { format, subDays } from 'date-fns';
import Select from 'react-select';
import CampaignHoverPopup from './CampaignHoverPopup';
import { preloadHistoryBatch } from './hoverCache';
import { analyzeAccounts, CreativeDiagnostic } from '../analise/diagnostics';

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

interface ClientImportProps {
  dbAccounts: AdAccount[];
  rtCampaigns: RtCampaign[];
}

export default function ClientImport({ dbAccounts, rtCampaigns }: ClientImportProps) {
  // Sort lists
  const sortedAccounts = [...dbAccounts].sort((a, b) => a.account_name.localeCompare(b.account_name));
  const sortedRtCampaigns = [...rtCampaigns].sort((a, b) => a.campaign_name.localeCompare(b.campaign_name));

  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [selectedRtCampaignId, setSelectedRtCampaignId] = useState<string>('');

  const [dateRangeFilter, setDateRangeFilter] = useState<'today'|'yesterday'|'7d'|'14d'|'30d'|'custom'>('today');
  const [dateFrom, setDateFrom] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));

  const [isImporting, setIsImporting] = useState(false);
  const [isSyncingToday, setIsSyncingToday] = useState(false);
  const [importResults, setImportResults] = useState<any[]>([]);
  const [rtTotals, setRtTotals] = useState<any>(null);
  const [perAccountTotals, setPerAccountTotals] = useState<any[]>([]);
  const [exchangeRate, setExchangeRate] = useState<number | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [tableSearch, setTableSearch] = useState('');
  
  // Sorting State
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);

  // Hover Popup State
  const [hoverTimeoutId, setHoverTimeoutId] = useState<any>(null);
  const [hoverData, setHoverData] = useState<{ x: number, y: number, group: any, accountId: string } | null>(null);

  const handleMouseEnterRow = (e: React.MouseEvent, group: any, accId: string) => {
    const x = e.clientX;
    const y = e.clientY;
    if (hoverTimeoutId) clearTimeout(hoverTimeoutId);

    // Pequeno delay pra nao bugar quando o mouse passa voando
    const tid = setTimeout(() => {
        setHoverData({ x, y, group, accountId: accId });
    }, 400);
    setHoverTimeoutId(tid);
  };

  const handleMouseLeaveRow = () => {
    if (hoverTimeoutId) clearTimeout(hoverTimeoutId);
    // Demora 300ms pra fechar permitindo que o mouse va ate a caixa
    const tid = setTimeout(() => setHoverData(null), 300);
    setHoverTimeoutId(tid);
  };

  const cancelMouseLeave = () => {
    if (hoverTimeoutId) clearTimeout(hoverTimeoutId);
  };

  // Seta por padrão os ultimos selecionados do localStorage, ou então o primeiro caso
  useEffect(() => {
    let initialAccountIds: string[] = sortedAccounts.length > 0 ? [sortedAccounts[0].account_id] : [];
    let initialRtCampaignId = sortedRtCampaigns.length > 0 ? sortedRtCampaigns[0].campaign_id : '';
    let initialDateRange = 'today';
    const today = new Date();
    let initialDateFrom = format(today, 'yyyy-MM-dd');
    let initialDateTo = format(today, 'yyyy-MM-dd');
    let initialSortConfig = null;

    try {
        const savedStr = localStorage.getItem('dopscale_prefs');
        if (savedStr) {
            const saved = JSON.parse(savedStr);
            // Novo formato: accountIds (array). Fallback para accountId legado (string).
            if (Array.isArray(saved.accountIds)) {
                const valid = saved.accountIds.filter((id: string) =>
                    sortedAccounts.some(a => a.account_id === id)
                );
                if (valid.length > 0) initialAccountIds = valid;
            } else if (saved.accountId && sortedAccounts.some(a => a.account_id === saved.accountId)) {
                initialAccountIds = [saved.accountId];
            }
            if (saved.rtCampaignId && sortedRtCampaigns.some(c => c.campaign_id === saved.rtCampaignId)) {
                initialRtCampaignId = saved.rtCampaignId;
            }
            if (saved.dateRange) {
                initialDateRange = saved.dateRange;
                if (saved.dateRange === 'custom') {
                    initialDateFrom = saved.dateFrom || initialDateFrom;
                    initialDateTo = saved.dateTo || initialDateTo;
                } else {
                    let f = today;
                    let t = today;
                    if (saved.dateRange === 'yesterday') { f = subDays(today, 1); t = subDays(today, 1); }
                    else if (saved.dateRange === '7d') { f = subDays(today, 6); }
                    else if (saved.dateRange === '14d') { f = subDays(today, 13); }
                    else if (saved.dateRange === '30d') { f = subDays(today, 29); }
                    initialDateFrom = format(f, 'yyyy-MM-dd');
                    initialDateTo = format(t, 'yyyy-MM-dd');
                }
            }
            if (saved.sortConfig !== undefined) {
                initialSortConfig = saved.sortConfig;
            }
        }
    } catch(e) {}

    setSelectedAccountIds(initialAccountIds);
    setSelectedRtCampaignId(initialRtCampaignId);
    setDateRangeFilter(initialDateRange as any);
    setDateFrom(initialDateFrom);
    setDateTo(initialDateTo);
    if (initialSortConfig) setSortConfig(initialSortConfig);
  }, []);

  // Salvar no storage sempre que os filtros principais mudarem
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
    const today = new Date();
    let from = today;
    let to = today;
    if (range === 'yesterday') {
      from = subDays(today, 1);
      to = subDays(today, 1);
    } else if (range === '7d') {
      from = subDays(today, 6);
    } else if (range === '14d') {
      from = subDays(today, 13);
    } else if (range === '30d') {
      from = subDays(today, 29);
    }
    setDateFrom(format(from, 'yyyy-MM-dd'));
    setDateTo(format(to, 'yyyy-MM-dd'));
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
      setExpandedRows(new Set());
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
      // Sincroniza em paralelo para todas as contas selecionadas
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
      // Recarrega a tabela com os dados frescos do banco
      await handleImport();
    } catch (error: any) {
      console.error(error);
      alert("Erro ao sincronizar hoje: " + error.message);
    } finally {
      setIsSyncingToday(false);
    }
  };

  // Auto-import when filters change
  useEffect(() => {
    handleImport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountIds, selectedRtCampaignId, dateFrom, dateTo]);

  // Pré-carrega o histórico de hover pra todos os rt_ads visíveis,
  // assim o popup abre instantâneo (cache hit). Uma chamada por conta.
  useEffect(() => {
    if (selectedAccountIds.length === 0 || !selectedRtCampaignId || importResults.length === 0) return;
    const rtAds = importResults.map((g: any) => g.rt_ad).filter(Boolean);
    for (const accId of selectedAccountIds) {
      preloadHistoryBatch(accId, selectedRtCampaignId, rtAds);
    }
  }, [importResults, selectedAccountIds, selectedRtCampaignId]);

  // Diagnóstico: roda o motor da /analise com os mesmos dados do dashboard
  // para popular chips de inteligência no hover do rt_ad.
  const diagnosticByAccAd = useMemo(() => {
    const map: Record<string, Record<string, CreativeDiagnostic>> = {};
    if (importResults.length === 0 || perAccountTotals.length === 0) return map;
    try {
      const accTotals = perAccountTotals.map((t: any) => ({
        account_id: t.account_id,
        account_name: t.account_name,
        cost: t.cost,
        revenue: t.revenue,
        profit: t.profit,
        conversions: t.conversions,
        roas: t.roas,
        cpa: t.cpa,
      }));
      const diags = analyzeAccounts(importResults as any, accTotals);
      for (const d of diags) {
        map[d.account_id] = {};
        for (const c of d.creatives) map[d.account_id][c.rt_ad] = c;
      }
    } catch (e) {
      console.warn('[Diagnostics]', e);
    }
    return map;
  }, [importResults, perAccountTotals]);

  const toggleRow = (rtAd: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(rtAd)) next.delete(rtAd); else next.add(rtAd);
      return next;
    });
  };

  const formatCurrency = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const formatPercent = (v: number) => v.toFixed(2) + '%';
  const formatNumber = (v: number) => v.toLocaleString('pt-BR');

  const getPillClass = (range: string) => {
    const base = "px-4 py-1.5 text-xs font-semibold rounded-md transition-colors ";
    return dateRangeFilter === range 
        ? base + "bg-indigo-600 text-white" 
        : base + "text-gray-600 hover:bg-gray-100 border border-transparent";
  };

  // Filtro + ordenação aplicados por conta. Cada seção chama isto com seus groups.
  const filterAndSortGroups = (groups: any[]) => {
    const filtered = groups.filter(group => {
      if (!tableSearch) return true;
      return group.rt_ad.toLowerCase().includes(tableSearch.toLowerCase()) ||
             group.meta_campaigns.some((mc: any) => mc.campaign_name.toLowerCase().includes(tableSearch.toLowerCase()));
    });
    return [...filtered].sort((a, b) => {
      if (!sortConfig) return 0;
      const { key, direction } = sortConfig;
      let valA = a[key] ?? 0;
      let valB = b[key] ?? 0;
      if (key === 'rt_ad') {
        valA = String(valA).toLowerCase();
        valB = String(valB).toLowerCase();
      }
      if (valA < valB) return direction === 'asc' ? -1 : 1;
      if (valA > valB) return direction === 'asc' ? 1 : -1;
      return 0;
    });
  };

  // Reagrupa finalReport para UMA conta específica: mantém só as meta_campaigns
  // dessa conta e recalcula os rollups do rt_ad (cost/revenue/roas/cpa/etc)
  // a partir apenas dessas campanhas. Descarta rt_ads que não têm campanhas
  // na conta em questão.
  const getAccountGroups = (accId: string): any[] => {
    return importResults
      .map((g: any) => {
        const mcs = g.meta_campaigns.filter((mc: any) => mc.account_id === accId);
        if (mcs.length === 0) return null;
        const totalSpend       = mcs.reduce((s: number, c: any) => s + c.spend, 0);
        const totalRevenue     = mcs.reduce((s: number, c: any) => s + c.revenue, 0);
        const totalConversions = mcs.reduce((s: number, c: any) => s + c.conversions, 0);
        const totalImpressions = mcs.reduce((s: number, c: any) => s + c.impressions, 0);
        const totalClicks      = mcs.reduce((s: number, c: any) => s + c.clicks, 0);
        const avgCpm = totalImpressions > 0
          ? mcs.reduce((s: number, c: any) => s + c.cpm * c.impressions, 0) / totalImpressions : 0;
        const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
        return {
          rt_ad:             g.rt_ad,
          cost:              totalSpend,
          total_revenue:     totalRevenue,
          total_conversions: totalConversions,
          cpa:               totalConversions > 0 ? totalSpend / totalConversions : 0,
          profit:            totalRevenue - totalSpend,
          roas:              totalSpend > 0 ? totalRevenue / totalSpend : 0,
          meta_cpm:          avgCpm,
          meta_ctr:          avgCtr,
          meta_impressions:  totalImpressions,
          meta_clicks:       totalClicks,
          meta_campaigns:    mcs,
          vturb_over_pitch_rate: g.vturb_over_pitch_rate,
          vturb_conversion_rate: g.vturb_conversion_rate,
        };
      })
      .filter(Boolean);
  };

  const requestSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'desc'; // Prioriza os maiores na primeira clicada (relevante para lucro/receita)
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') {
        direction = 'asc';
    }
    setSortConfig({ key, direction });
  };

  const TableHeader = ({ label, sortKey, alignLeft = false, colSpan = 1 }: any) => {
      const isActive = sortConfig?.key === sortKey;
      return (
        <div 
            className={`px-4 py-3 cursor-pointer hover:bg-gray-200 transition-colors flex items-center gap-1.5 select-none ${alignLeft ? 'justify-start' : 'justify-end'} ${colSpan > 1 ? 'col-span-2 px-6' : ''}`}
            onClick={() => requestSort(sortKey)}
        >
            {label}
            <span className={`text-[9px] ${isActive ? 'text-indigo-600' : 'text-gray-300'}`}>
                {isActive ? (sortConfig?.direction === 'asc' ? '▲' : '▼') : '↕'}
            </span>
        </div>
      );
  };

  return (
    <div className="flex flex-col gap-6">
      
      {/* 1. Header Controls */}
      <div className="flex flex-wrap md:flex-nowrap items-center justify-between gap-4 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        
        {/* Dropdowns */}
        <div className="flex items-center gap-3">
            <div className="min-w-[250px]">
                <Select
                    instanceId="select-rt-campaign"
                    options={sortedRtCampaigns.map(c => ({ value: c.campaign_id, label: c.campaign_name }))}
                    value={sortedRtCampaigns.map(c => ({ value: c.campaign_id, label: c.campaign_name })).find(o => o.value === selectedRtCampaignId) || null}
                    onChange={(selected: any) => setSelectedRtCampaignId(selected?.value || '')}
                    placeholder="Selecione RedTrack"
                    className="text-sm rounded-lg"
                    styles={{ control: (base) => ({ ...base, minHeight: '38px', borderRadius: '0.5rem', borderColor: '#e5e7eb', backgroundColor: '#f9fafb' }) }}
                />
            </div>

            <div className="min-w-[320px]">
                <Select
                    instanceId="select-meta-account"
                    isMulti
                    closeMenuOnSelect={false}
                    options={sortedAccounts.map(a => ({ value: a.account_id, label: a.account_name }))}
                    value={sortedAccounts
                        .filter(a => selectedAccountIds.includes(a.account_id))
                        .map(a => ({ value: a.account_id, label: a.account_name }))}
                    onChange={(selected: any) => setSelectedAccountIds((selected || []).map((o: any) => o.value))}
                    placeholder="Selecione contas Meta"
                    className="text-sm rounded-lg"
                    styles={{ control: (base) => ({ ...base, minHeight: '38px', borderRadius: '0.5rem', borderColor: '#e5e7eb', backgroundColor: '#f9fafb' }) }}
                />
            </div>

            {/* Atualizar: lê do banco de dados */}
            <button
                onClick={() => handleImport()}
                disabled={isImporting}
                title="Carregar dados do banco de dados"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-gray-200 text-gray-500 hover:bg-gray-100 hover:text-indigo-600 hover:border-indigo-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
                <svg className={`h-3.5 w-3.5 ${isImporting ? 'animate-spin' : ''}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {isImporting ? 'Carregando...' : 'Atualizar'}
            </button>

            {/* Recarregar: relê do banco de dados (sincronização com APIs fica em Configurações) */}
            <button
                onClick={() => handleImport()}
                disabled={isImporting || isSyncingToday}
                title="Recarregar dados do banco (para sincronizar com Meta e RedTrack, use Configurações)"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-amber-200 text-amber-600 hover:bg-amber-50 hover:border-amber-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
                <svg className={`h-3.5 w-3.5 ${isImporting ? 'animate-spin' : ''}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                Recarregar
            </button>

            {/* Sincronizar Hoje: busca dados do dia atual via API e atualiza o banco */}
            <button
                onClick={handleSyncToday}
                disabled={isImporting || isSyncingToday}
                title="Buscar dados de hoje via API (Meta + RedTrack) e atualizar o banco"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-emerald-200 text-emerald-600 hover:bg-emerald-50 hover:border-emerald-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
                <svg className={`h-3.5 w-3.5 ${isSyncingToday ? 'animate-spin' : ''}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m8.66-13l-.87.5M4.21 15.5l-.87.5M20.66 15.5l-.87-.5M4.21 8.5l-.87-.5M21 12h-1M4 12H3" />
                    <circle cx="12" cy="12" r="4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {isSyncingToday ? 'Sincronizando...' : 'Hoje (API)'}
            </button>
        </div>

        {/* Date Filters */}
        <div className="flex items-center gap-1 border border-gray-200 rounded-lg p-1 bg-white">
            <button onClick={() => handleDateShortcut('today')} className={getPillClass('today')}>Hoje</button>
            <button onClick={() => handleDateShortcut('yesterday')} className={getPillClass('yesterday')}>Ontem</button>
            <button onClick={() => handleDateShortcut('7d')} className={getPillClass('7d')}>7 dias</button>
            <button onClick={() => handleDateShortcut('14d')} className={getPillClass('14d')}>14 dias</button>
            <button onClick={() => handleDateShortcut('30d')} className={getPillClass('30d')}>30 dias</button>
            
            <div className={`flex items-center gap-1 px-2 ${dateRangeFilter === 'custom' ? 'bg-indigo-50 rounded' : ''}`}>
                <input type="date" value={dateFrom} onChange={e => handleCustomDateChange('from', e.target.value)} className="text-xs bg-transparent text-gray-700 outline-none" />
                <span className="text-xs text-gray-400">até</span>
                <input type="date" value={dateTo} onChange={e => handleCustomDateChange('to', e.target.value)} className="text-xs bg-transparent text-gray-700 outline-none" />
            </div>
        </div>

      </div>

      {/* 2. Top Summary Cards */}
      {rtTotals && (
        <div className="flex w-full gap-4 overflow-x-auto pb-2">
            {[
                { title: 'RECEITA', value: formatCurrency(rtTotals.revenue), color: 'text-gray-800' },
                { title: 'GASTO', value: formatCurrency(rtTotals.cost), color: 'text-rose-500' },
                { title: 'LUCRO', value: formatCurrency(rtTotals.profit), color: rtTotals.profit >= 0 ? 'text-emerald-500' : 'text-rose-500' },
                { title: 'ROAS', value: rtTotals.roas > 0 ? rtTotals.roas.toFixed(2) + 'x' : '0.00x', color: rtTotals.roas >= 1 ? 'text-amber-500' : 'text-gray-500' },
                { title: 'VENDAS', value: rtTotals.conversions.toString(), color: 'text-gray-800' },
                { title: 'CPA', value: formatCurrency(rtTotals.cpa), color: 'text-gray-800' },
                { title: 'RET. PITCH', value: rtTotals.vturb_over_pitch_rate != null ? formatPercent(rtTotals.vturb_over_pitch_rate) : '—', color: 'text-fuchsia-500' },
                { title: 'CONV. VTURB', value: rtTotals.vturb_conversion_rate != null ? formatPercent(rtTotals.vturb_conversion_rate) : '—', color: 'text-fuchsia-500' },
            ].map((card, i) => (
                <div key={i} className="flex-1 bg-white min-w-[150px] p-5 rounded-xl border border-gray-100 shadow-sm flex flex-col justify-center">
                    <h3 className="text-[10px] text-gray-400 font-bold tracking-wider mb-2 uppercase">{card.title}</h3>
                    <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
                </div>
            ))}
            {exchangeRate !== null && (
              <div className="flex flex-col justify-center self-stretch px-4 py-3 bg-white rounded-xl border border-gray-100 shadow-sm whitespace-nowrap">
                <h3 className="text-[10px] text-gray-400 font-bold tracking-wider mb-2 uppercase">USD/BRL</h3>
                <p className="text-2xl font-bold text-gray-800">R$ {exchangeRate.toFixed(4).replace('.', ',')}</p>
              </div>
            )}
        </div>
      )}

      {/* 3. Uma tabela por conta selecionada, com o resumo da conta no topo da seção */}
      {importResults.length === 0 && !isImporting && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-12 text-center text-gray-400 text-sm">
            Nenhum resultado encontrado para o período selecionado.
        </div>
      )}

      {selectedAccountIds.map((accId) => {
        const accName = sortedAccounts.find(a => a.account_id === accId)?.account_name ?? accId;
        const accTotals = perAccountTotals.find((t: any) => t.account_id === accId);
        const accGroups = getAccountGroups(accId);
        const accSorted = filterAndSortGroups(accGroups);
        const accProfit = accTotals?.profit ?? 0;
        const accRoas = accTotals?.roas ?? 0;
        const accProfitColor = accProfit >= 0 ? 'text-emerald-500' : 'text-rose-500';
        const accRoasColor = accRoas >= 1 ? 'text-emerald-500' : accRoas > 0 ? 'text-amber-500' : 'text-gray-400';

        return (
        <div key={accId} className="bg-white border text-gray-800 border-gray-200 rounded-xl shadow-sm overflow-hidden flex flex-col">

          {/* Account Header + Summary */}
          <div className="px-5 py-3 border-b border-gray-100 bg-gradient-to-r from-indigo-50/40 to-transparent flex flex-wrap items-center gap-x-8 gap-y-2">
            <div className="flex items-center gap-2 min-w-[200px]">
              <div className="w-1.5 h-6 bg-indigo-500 rounded-sm" />
              <div>
                <div className="text-[10px] text-gray-400 font-bold tracking-wider uppercase">Conta</div>
                <div className="text-sm font-bold text-gray-800 truncate max-w-[280px]" title={accName}>{accName}</div>
              </div>
            </div>
            {accTotals && (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs ml-auto">
                <div className="flex flex-col">
                  <span className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">Gasto</span>
                  <span className="font-mono font-semibold text-rose-500">{formatCurrency(accTotals.cost)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">Receita</span>
                  <span className="font-mono font-semibold text-gray-800">{formatCurrency(accTotals.revenue)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">Lucro</span>
                  <span className={`font-mono font-bold ${accProfitColor}`}>{formatCurrency(accTotals.profit)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">ROAS</span>
                  <span className={`font-mono font-bold ${accRoasColor}`}>{accTotals.roas > 0 ? accTotals.roas.toFixed(2)+'x' : '—'}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">Vendas</span>
                  <span className="font-mono font-semibold text-gray-800">{formatNumber(accTotals.conversions)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">CPA</span>
                  <span className="font-mono font-semibold text-gray-800">{accTotals.cpa > 0 ? formatCurrency(accTotals.cpa) : '—'}</span>
                </div>
              </div>
            )}
          </div>

          {/* Table Toolbar */}
          <div className="p-4 border-b border-gray-100 flex items-center gap-4 bg-white">
              <span className="text-xs text-gray-400 font-semibold">{accSorted.length} campanhas</span>
              <div className="relative">
                  <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  <input
                      type="text"
                      placeholder="Filtrar campanha..."
                      className="pl-9 pr-4 py-1.5 border border-gray-200 rounded-md text-xs w-64 outline-none focus:border-indigo-500 bg-gray-50"
                      value={tableSearch}
                      onChange={e => setTableSearch(e.target.value)}
                  />
              </div>
          </div>

          {/* Table Header */}
          <div className="grid grid-cols-12 bg-gray-50 text-[10px] text-gray-500 font-bold uppercase tracking-wider border-b border-gray-200">
            <TableHeader label="Campanha" sortKey="rt_ad" alignLeft={true} colSpan={2} />
            <TableHeader label="Gasto" sortKey="total_spend" />
            <TableHeader label="Receita" sortKey="total_revenue" />
            <TableHeader label="Vendas" sortKey="total_conversions" />
            <TableHeader label="CPA" sortKey="cpa" />
            <TableHeader label="Lucro" sortKey="profit" />
            <TableHeader label="ROAS" sortKey="roas" />
            <TableHeader label="CPM" sortKey="total_spend" />
            <TableHeader label="CTR" sortKey="total_revenue" />
            <TableHeader label="Ret. Pitch" sortKey="vturb_over_pitch_rate" />
            <TableHeader label="Conv. VT" sortKey="vturb_conversion_rate" />
          </div>

          {/* Table Body */}
          {accSorted.length === 0 && (
            <div className="p-8 text-center text-gray-400 text-xs">
              Sem campanhas desta conta no período.
            </div>
          )}

          <div className="divide-y divide-gray-100">
            {accSorted.map((group: any) => {
                const expandKey = `${accId}::${group.rt_ad}`;
                const isOpen = expandedRows.has(expandKey);
                const profitColor = group.profit >= 0 ? 'text-emerald-500' : 'text-rose-500';
                const roasColor = group.roas >= 1 ? 'text-emerald-500' : group.roas > 0 ? 'text-amber-500' : 'text-gray-400';

                return (
                <div key={expandKey}>
                    {/* Row level 1 */}
                    <div
                        className="grid grid-cols-12 text-xs hover:bg-gray-50 transition-colors group relative"
                    >
                        <div className="col-span-2 px-6 py-3.5 flex items-center gap-3">
                            <div className="flex items-center justify-center w-8 cursor-pointer" onClick={() => toggleRow(expandKey)}>
                                {/* Toggle Arrow */}
                                <div className={`w-5 h-5 flex items-center justify-center rounded bg-gray-100 text-gray-400 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors ${isOpen ? 'rotate-90' : ''}`}>
                                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>
                                </div>
                            </div>
                            <span
                                className="font-bold text-gray-800 cursor-help"
                                onMouseEnter={(e) => handleMouseEnterRow(e, group, accId)}
                                onMouseLeave={handleMouseLeaveRow}
                            >
                                {group.rt_ad}
                            </span>
                            {group.meta_campaigns.length > 0 && (
                                <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full font-medium">
                                    {group.meta_campaigns.length}
                                </span>
                            )}
                        </div>
                        <div className="px-4 py-3.5 text-right font-mono font-medium">{formatCurrency(group.cost)}</div>
                        <div className="px-4 py-3.5 text-right font-mono font-medium">{formatCurrency(group.total_revenue)}</div>
                        <div className="px-4 py-3.5 text-right font-mono font-bold">{group.total_conversions} <span className="text-gray-400 text-[10px] font-sans">v</span></div>
                        <div className="px-4 py-3.5 text-right font-mono font-medium">{group.cpa > 0 ? formatCurrency(group.cpa) : '—'}</div>
                        <div className={`px-4 py-3.5 text-right font-mono font-bold ${profitColor}`}>{formatCurrency(group.profit)}</div>
                        <div className={`px-4 py-3.5 text-right font-mono font-bold ${roasColor}`}>{group.roas > 0 ? group.roas.toFixed(2)+'x' : '—'}</div>
                        <div className="px-4 py-3.5 text-right font-mono text-gray-500">{group.meta_cpm > 0 ? formatCurrency(group.meta_cpm) : '—'}</div>
                        <div className="px-4 py-3.5 text-right font-mono text-gray-500">{group.meta_ctr > 0 ? formatPercent(group.meta_ctr) : '—'}</div>
                        <div className="px-4 py-3.5 text-right font-mono text-fuchsia-500">{group.vturb_over_pitch_rate != null ? formatPercent(group.vturb_over_pitch_rate) : '—'}</div>
                        <div className="px-4 py-3.5 text-right font-mono text-fuchsia-500">{group.vturb_conversion_rate != null ? formatPercent(group.vturb_conversion_rate) : '—'}</div>
                    </div>

                    {/* Meta Campaigns Wrapper */}
                    {isOpen && group.meta_campaigns.length > 0 && (
                    <div className="bg-gray-50/50 border-t border-b border-gray-100 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]">
                        <div className="grid grid-cols-12 text-[10px] text-gray-400 font-bold uppercase tracking-wider border-b border-gray-100/50">
                            <div className="col-span-2 px-6 py-2 pl-16">Anúncio Facebook</div>
                            <div className="px-4 py-2 text-right">Gasto FB</div>
                            <div className="px-4 py-2 text-right">Receita RT</div>
                            <div className="px-4 py-2 text-right">Vendas RT</div>
                            <div className="px-4 py-2 text-right">CPA RT</div>
                            <div className="px-4 py-2 text-right">Lucro Líq</div>
                            <div className="px-4 py-2 text-right">ROAS Líq</div>
                            <div className="px-4 py-2 text-right">CPM</div>
                            <div className="px-4 py-2 text-right">CTR</div>
                            <div className="px-4 py-2 text-right">Ret. Pitch</div>
                            <div className="px-4 py-2 text-right">Conv. VT Camp.</div>
                        </div>
                        {([...group.meta_campaigns].sort((a: any, b: any) => {
          if (!sortConfig) return 0;
          const { key, direction } = sortConfig;
          const mcKeyMap: Record<string, string> = {
            rt_ad: 'campaign_name',
            total_spend: 'spend',
            total_revenue: 'revenue',
            total_conversions: 'conversions',
            cpa: 'cpa',
            profit: 'profit',
            roas: 'roas',
          };
          const mcKey = mcKeyMap[key] ?? key;
          let valA = a[mcKey] ?? 0;
          let valB = b[mcKey] ?? 0;
          if (mcKey === 'campaign_name') { valA = String(valA).toLowerCase(); valB = String(valB).toLowerCase(); }
          if (valA < valB) return direction === 'asc' ? -1 : 1;
          if (valA > valB) return direction === 'asc' ? 1 : -1;
          return 0;
        })).map((mc: any, idx: number) => {
                        const mcProfitColor = mc.profit >= 0 ? 'text-emerald-500' : 'text-rose-500';
                        const mcRoasColor = mc.roas >= 1 ? 'text-emerald-500' : mc.roas > 0 ? 'text-amber-500' : 'text-gray-400';
                        return (
                            <div key={mc.campaign_id + '-' + idx} className="grid grid-cols-12 text-xs hover:bg-gray-50 border-b border-gray-50 last:border-transparent transition-colors">
                            <div className="col-span-2 px-6 py-3 pl-16 text-gray-500 break-words whitespace-normal leading-relaxed text-[11px]">
                                {mc.campaign_name}
                            </div>
                            <div className="px-4 py-3 text-right font-mono text-gray-500">{formatCurrency(mc.spend)}</div>
                            <div className="px-4 py-3 text-right font-mono text-gray-500">{mc.revenue > 0 ? formatCurrency(mc.revenue) : '—'}</div>
                            <div className="px-4 py-3 text-right font-mono text-gray-500">{mc.conversions > 0 ? mc.conversions : '—'}</div>
                            <div className="px-4 py-3 text-right font-mono text-gray-500">{mc.cpa > 0 ? formatCurrency(mc.cpa) : '—'}</div>
                            <div className={`px-4 py-3 text-right font-mono font-medium ${mc.revenue > 0 ? mcProfitColor : 'text-gray-400'}`}>{mc.revenue > 0 ? formatCurrency(mc.profit) : '—'}</div>
                            <div className={`px-4 py-3 text-right font-mono font-medium ${mc.revenue > 0 ? mcRoasColor : 'text-gray-400'}`}>{mc.roas > 0 ? mc.roas.toFixed(2)+'x' : '—'}</div>
                            <div className="px-4 py-3 text-right font-mono text-gray-400">{formatCurrency(mc.cpm)}</div>
                            <div className="px-4 py-3 text-right font-mono text-gray-400">{formatPercent(mc.ctr)}</div>
                            <div className="px-4 py-3 text-right font-mono text-fuchsia-400">{mc.vturb_over_pitch_rate != null ? formatPercent(mc.vturb_over_pitch_rate) : '—'}</div>
                            <div className="px-4 py-3 text-right font-mono text-fuchsia-400">{mc.vturb_conversion_rate != null ? formatPercent(mc.vturb_conversion_rate) : '—'}</div>
                            </div>
                        );
                        })}
                    </div>
                    )}
                </div>
                );
            })}
          </div>
        </div>
        );
      })}

    {/* Hover Popup Overlay Render */}
    {hoverData && (
        <CampaignHoverPopup
           x={hoverData.x}
           y={hoverData.y}
           groupData={hoverData.group}
           accountId={hoverData.accountId}
           rtCampaignId={selectedRtCampaignId}
           diagnostic={diagnosticByAccAd[hoverData.accountId]?.[hoverData.group?.rt_ad] ?? null}
           onMouseEnter={cancelMouseLeave}
           onMouseLeave={handleMouseLeaveRow}
        />
    )}

    </div>
  );
}
