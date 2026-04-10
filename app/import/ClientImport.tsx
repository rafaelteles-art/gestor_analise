'use client';

import React, { useState, useEffect } from 'react';
import { format, subDays } from 'date-fns';
import Select from 'react-select';
import CampaignHoverPopup from './CampaignHoverPopup';

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

  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [selectedRtCampaignId, setSelectedRtCampaignId] = useState<string>('');

  const [dateRangeFilter, setDateRangeFilter] = useState<'today'|'yesterday'|'7d'|'14d'|'30d'|'custom'>('today');
  const [dateFrom, setDateFrom] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));

  const [isImporting, setIsImporting] = useState(false);
  const [importResults, setImportResults] = useState<any[]>([]);
  const [rtTotals, setRtTotals] = useState<any>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [tableSearch, setTableSearch] = useState('');
  
  // Sorting State
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);

  // Hover Popup State
  const [hoverTimeoutId, setHoverTimeoutId] = useState<any>(null);
  const [hoverData, setHoverData] = useState<{ x: number, y: number, group: any } | null>(null);

  const handleMouseEnterRow = (e: React.MouseEvent, group: any) => {
    const x = e.clientX;
    const y = e.clientY;
    if (hoverTimeoutId) clearTimeout(hoverTimeoutId);
    
    // Pequeno delay pra nao bugar quando o mouse passa voando
    const tid = setTimeout(() => {
        setHoverData({ x, y, group });
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
    let initialAccountId = sortedAccounts.length > 0 ? sortedAccounts[0].account_id : '';
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
            if (saved.accountId && sortedAccounts.some(a => a.account_id === saved.accountId)) {
                initialAccountId = saved.accountId;
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

    setSelectedAccountId(initialAccountId);
    setSelectedRtCampaignId(initialRtCampaignId);
    setDateRangeFilter(initialDateRange as any);
    setDateFrom(initialDateFrom);
    setDateTo(initialDateTo);
    if (initialSortConfig) setSortConfig(initialSortConfig);
  }, []);

  // Salvar no storage sempre que os filtros principais mudarem
  useEffect(() => {
    if (!selectedAccountId || !selectedRtCampaignId) return;
    try {
        localStorage.setItem('dopscale_prefs', JSON.stringify({
            accountId: selectedAccountId,
            rtCampaignId: selectedRtCampaignId,
            dateRange: dateRangeFilter,
            dateFrom: dateRangeFilter === 'custom' ? dateFrom : null,
            dateTo: dateRangeFilter === 'custom' ? dateTo : null,
            sortConfig: sortConfig
        }));
    } catch(e) {}
  }, [selectedAccountId, selectedRtCampaignId, dateRangeFilter, dateFrom, dateTo, sortConfig]);

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
    if (!selectedAccountId || !selectedRtCampaignId || !dateFrom || !dateTo) return;

    setIsImporting(true);
    try {
      const acc = sortedAccounts.find(a => a.account_id === selectedAccountId);
      const camp = sortedRtCampaigns.find(c => c.campaign_id === selectedRtCampaignId);

      const response = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dateFrom,
          dateTo,
          accounts: acc ? [acc] : [],
          rtCampaigns: camp ? [camp] : [],
          filterRegex: ''
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setImportResults(data.data || []);
      setRtTotals(data.rt_totals || null);
      setExpandedRows(new Set());
    } catch (error: any) {
      console.error(error);
      alert("Erro ao cruzar dados: " + error.message);
    } finally {
      setIsImporting(false);
    }
  };

  // Auto-import when filters change
  useEffect(() => {
    handleImport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId, selectedRtCampaignId, dateFrom, dateTo]);

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

  // Filtrar tabela principal
  const filteredResults = importResults.filter(group => {
    if (!tableSearch) return true;
    return group.rt_ad.toLowerCase().includes(tableSearch.toLowerCase()) || 
           group.meta_campaigns.some((mc: any) => mc.campaign_name.toLowerCase().includes(tableSearch.toLowerCase()));
  });

  const requestSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'desc'; // Prioriza os maiores na primeira clicada (relevante para lucro/receita)
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') {
        direction = 'asc';
    }
    setSortConfig({ key, direction });
  };

  const sortedFilteredResults = [...filteredResults].sort((a, b) => {
      if (!sortConfig) return 0;
      const { key, direction } = sortConfig;
      
      let valA = a[key] ?? 0;
      let valB = b[key] ?? 0;

      // Lidando com formato string no Nome do Anúncio
      if (key === 'rt_ad') {
          valA = String(valA).toLowerCase();
          valB = String(valB).toLowerCase();
      }

      if (valA < valB) return direction === 'asc' ? -1 : 1;
      if (valA > valB) return direction === 'asc' ? 1 : -1;
      return 0;
  });

  const TableHeader = ({ label, sortKey, alignLeft = false, colSpan = 1 }: any) => {
      const isActive = sortConfig?.key === sortKey;
      return (
        <div 
            className={`px-4 py-3 cursor-pointer hover:bg-gray-200 transition-colors flex items-center gap-1.5 select-none ${alignLeft ? 'justify-start' : 'justify-end'} ${colSpan > 1 ? 'col-span-2 px-6' : ''}`}
            onClick={() => requestSort(sortKey)}
        >
            {label}
            <span className={`text-[9px] ${isActive ? 'text-indigo-600' : 'text-gray-300'}`}>
                {isActive ? (sortConfig.direction === 'asc' ? '▲' : '▼') : '↕'}
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
                    options={sortedRtCampaigns.map(c => ({ value: c.campaign_id, label: c.campaign_name }))}
                    value={sortedRtCampaigns.map(c => ({ value: c.campaign_id, label: c.campaign_name })).find(o => o.value === selectedRtCampaignId) || null}
                    onChange={(selected: any) => setSelectedRtCampaignId(selected?.value || '')}
                    placeholder="Selecione RedTrack"
                    className="text-sm rounded-lg"
                    styles={{ control: (base) => ({ ...base, minHeight: '38px', borderRadius: '0.5rem', borderColor: '#e5e7eb', backgroundColor: '#f9fafb' }) }}
                />
            </div>

            <div className="min-w-[250px]">
                <Select
                    options={sortedAccounts.map(a => ({ value: a.account_id, label: a.account_name }))}
                    value={sortedAccounts.map(a => ({ value: a.account_id, label: a.account_name })).find(o => o.value === selectedAccountId) || null}
                    onChange={(selected: any) => setSelectedAccountId(selected?.value || '')}
                    placeholder="Selecione Meta Ads"
                    className="text-sm rounded-lg"
                    styles={{ control: (base) => ({ ...base, minHeight: '38px', borderRadius: '0.5rem', borderColor: '#e5e7eb', backgroundColor: '#f9fafb' }) }}
                />
            </div>

            {isImporting && (
                <div className="flex items-center gap-2 text-indigo-600 text-xs font-semibold">
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    Sincronizando...
                </div>
            )}
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
            ].map((card, i) => (
                <div key={i} className="flex-1 bg-white min-w-[150px] p-5 rounded-xl border border-gray-100 shadow-sm flex flex-col justify-center">
                    <h3 className="text-[10px] text-gray-400 font-bold tracking-wider mb-2 uppercase">{card.title}</h3>
                    <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
                </div>
            ))}
        </div>
      )}

      {/* 3. Table */}
      <div className="bg-white border text-gray-800 border-gray-200 rounded-xl shadow-sm overflow-hidden flex flex-col mt-2">
          
          {/* Table Toolbar */}
          <div className="p-4 border-b border-gray-100 flex items-center gap-4 bg-white">
              <span className="text-xs text-gray-400 font-semibold">{filteredResults.length} campanhas</span>
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
          <div className="grid grid-cols-10 bg-gray-50 text-[10px] text-gray-500 font-bold uppercase tracking-wider border-b border-gray-200">
            <TableHeader label="Campanha" sortKey="rt_ad" alignLeft={true} colSpan={2} />
            <TableHeader label="Gasto" sortKey="total_spend" />
            <TableHeader label="Receita" sortKey="total_revenue" />
            <TableHeader label="Vendas" sortKey="total_conversions" />
            <TableHeader label="CPA" sortKey="cpa" />
            <TableHeader label="Lucro" sortKey="profit" />
            <TableHeader label="ROAS" sortKey="roas" />
            <TableHeader label="CPM" sortKey="total_spend" />
            <TableHeader label="CTR" sortKey="total_revenue" /> 
            {/* CPM and CTR sorting maps currently follow broad logical rules since real combined avg CPM is complex, standardizing by spend/clicks temporarily */}
          </div>

          {/* Table Body */}
          {importResults.length === 0 && !isImporting && (
                <div className="p-12 text-center text-gray-400 text-sm">
                    Nenhum resultado encontrado para o período selecionado.
                </div>
          )}

          <div className="divide-y divide-gray-100">
            {sortedFilteredResults.map((group: any) => {
                const isOpen = expandedRows.has(group.rt_ad);
                const profitColor = group.profit >= 0 ? 'text-emerald-500' : 'text-rose-500';
                const roasColor = group.roas >= 1 ? 'text-emerald-500' : group.roas > 0 ? 'text-amber-500' : 'text-gray-400';

                return (
                <div key={group.rt_ad}>
                    {/* Row level 1 */}
                    <div
                        className="grid grid-cols-10 text-xs hover:bg-gray-50 transition-colors group relative"
                    >
                        <div className="col-span-2 px-6 py-3.5 flex items-center gap-3">
                            <div className="flex items-center justify-center w-8 cursor-pointer" onClick={() => toggleRow(group.rt_ad)}>
                                {/* Toggle Arrow */}
                                <div className={`w-5 h-5 flex items-center justify-center rounded bg-gray-100 text-gray-400 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors ${isOpen ? 'rotate-90' : ''}`}>
                                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>
                                </div>
                            </div>
                            <span 
                                className="font-bold text-gray-800 cursor-help"
                                onMouseEnter={(e) => handleMouseEnterRow(e, group)}
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
                    </div>

                    {/* Meta Campaigns Wrapper */}
                    {isOpen && group.meta_campaigns.length > 0 && (
                    <div className="bg-gray-50/50 border-t border-b border-gray-100 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]">
                        <div className="grid grid-cols-10 text-[10px] text-gray-400 font-bold uppercase tracking-wider border-b border-gray-100/50">
                            <div className="col-span-2 px-6 py-2 pl-16">Anúncio Facebook</div>
                            <div className="px-4 py-2 text-right">Gasto FB</div>
                            <div className="px-4 py-2 text-right">Receita RT</div>
                            <div className="px-4 py-2 text-right">Vendas RT</div>
                            <div className="px-4 py-2 text-right">CPA RT</div>
                            <div className="px-4 py-2 text-right">Lucro Líq</div>
                            <div className="px-4 py-2 text-right">ROAS Líq</div>
                            <div className="px-4 py-2 text-right">CPM</div>
                            <div className="px-4 py-2 text-right">CTR</div>
                        </div>
                        {group.meta_campaigns.map((mc: any, idx: number) => {
                        const mcProfitColor = mc.profit >= 0 ? 'text-emerald-500' : 'text-rose-500';
                        const mcRoasColor = mc.roas >= 1 ? 'text-emerald-500' : mc.roas > 0 ? 'text-amber-500' : 'text-gray-400';
                        return (
                            <div key={mc.campaign_id + '-' + idx} className="grid grid-cols-10 text-xs hover:bg-gray-50 border-b border-gray-50 last:border-transparent transition-colors">
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

    {/* Hover Popup Overlay Render */}
    {hoverData && (
        <CampaignHoverPopup 
           x={hoverData.x}
           y={hoverData.y}
           groupData={hoverData.group}
           accountId={selectedAccountId}
           rtCampaignId={selectedRtCampaignId}
           onMouseEnter={cancelMouseLeave}
           onMouseLeave={handleMouseLeaveRow}
        />
    )}

    </div>
  );
}
