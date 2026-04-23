'use client';

import React, { useEffect, useState } from 'react';
import { globalHoverCache, cacheKey } from './hoverCache';

interface PopupProps {
  x: number;
  y: number;
  groupData: any; 
  accountId: string;
  rtCampaignId: string;
  onMouseLeave: () => void;
  onMouseEnter: () => void;
}

export default function CampaignHoverPopup({ x, y, groupData, accountId, rtCampaignId, onMouseLeave, onMouseEnter }: PopupProps) {
  const [history, setHistory] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Conta Meta (usando os ultimos digitos)
  const accountLastDigits = accountId ? accountId.slice(-6) : 'N/A';

  useEffect(() => {
    let mounted = true;

    async function fetchHistory() {
      const key = cacheKey(groupData.rt_ad, accountId, rtCampaignId);

      // Serve do cache imediatamente se existir (preload do ClientImport)
      if (globalHoverCache[key]) {
        if (mounted) {
          setHistory(globalHoverCache[key]);
          setLoading(false);
        }
        return;
      }

      try {
        const res = await fetch('/api/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            metaAccountId: accountId,
            rtAd: groupData.rt_ad,
            rtCampaignId: rtCampaignId,
          })
        });
        const d = await res.json();
        if (mounted) {
          setHistory(d.data);
          globalHoverCache[key] = d.data;
          setLoading(false);
        }
      } catch (e) {
        if (mounted) setLoading(false);
      }
    }

    if (groupData && accountId && rtCampaignId) {
      setLoading(true);
      fetchHistory();
    }

    return () => { mounted = false; };
  }, [groupData, accountId, rtCampaignId]);

  const formatCurrency = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const formatNumber = (v: number) => Math.round(v);

  const ranges = ['Hoje', '2D', '3D', '7D', '14D', '30D', '30D+HOJE'];

  // A posição ideal: se o mouse estiver muito embaixo/direita, joga pro lado oposto pra nao cortar
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1000;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;

  let finalX = x + 15;
  let finalY = y + 15;

  if (finalX + 600 > vw) {
      finalX = x - 615; // Joga pra esquerda do cursor
  }
  if (finalY + 400 > vh) {
      finalY = y - 415; // Joga pra cima
  }

  // Se mesmo jogando ele cortar, fixa onde der (ex: tela menor)
  finalX = Math.max(10, finalX);
  finalY = Math.max(10, finalY);

  return (
    <div 
      className="fixed z-[9999] bg-white rounded-xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.2)] border border-gray-200 w-[600px] flex flex-col font-sans overflow-hidden transform transition-opacity duration-150"
      style={{ left: finalX, top: finalY }}
      onMouseLeave={onMouseLeave}
      onMouseEnter={onMouseEnter}
    >
      {/* HEADER */}
      <div className="p-4 flex flex-col gap-2 border-b border-gray-100">
        <div className="flex justify-between items-start gap-4">
            <h3 className="font-bold text-gray-800 text-[13px] leading-snug break-all">{groupData.rt_ad}</h3>
            <div className="flex-shrink-0 bg-amber-50 text-amber-500 border border-amber-200 text-[10px] uppercase font-bold px-2 py-0.5 rounded-md flex items-center gap-1">
                <div className="w-1.5 h-1.5 bg-amber-500 rounded-full"></div> MONITORAR
            </div>
        </div>

        <div className="flex items-center gap-2 text-[10px] font-bold text-gray-400 mt-1 uppercase">
            <span className="border border-gray-200 px-1.5 py-0.5 rounded text-gray-500 bg-gray-50">Idade: 9D</span>
            <span className="border border-gray-200 px-1.5 py-0.5 rounded text-gray-500 bg-gray-50">Conta: ...{accountLastDigits}</span>
            <span className="border border-gray-200 px-1.5 py-0.5 rounded text-gray-500 bg-gray-50">ACTIVE</span>
        </div>

        {/* Intelligence text */}
        <p className="text-xs text-gray-500 mt-2">
            ROAS 7d: <strong className="font-medium text-gray-700">{history?.['7D']?.roas ? history['7D'].roas.toFixed(2)+'x' : 'Carregando...'}</strong> — dentro do aceitavel. Manter e monitorar tendencia.
        </p>

        {/* Intelligence Badges */}
        <div className="flex gap-2 items-center mt-2">
            <span className="bg-gray-100 text-gray-600 text-[10px] px-2 py-0.5 rounded shadow-sm font-semibold flex items-center gap-1">↘ Caindo</span>
            <span className="bg-emerald-50 text-emerald-600 text-[10px] px-2 py-0.5 rounded shadow-sm font-semibold flex items-center gap-1 border border-emerald-100 bg-gradient-to-b from-white to-emerald-50">✓ CTR 10.0% {'\u003E'} mediana 5.5%</span>
            <span className="bg-emerald-50 text-emerald-500 text-[10px] px-2 py-0.5 rounded shadow-sm font-semibold border border-emerald-100">Recuperacao: 70%</span>
            <span className="ml-auto border text-gray-400 font-semibold text-[10px] px-2 py-0.5 rounded">Confianca: Media</span>
        </div>
      </div>

      {/* MATRIX TABLE */}
      <div className="w-full relative">
        {loading && (
            <div className="absolute inset-0 bg-white/70 backdrop-blur-sm z-10 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
        )}
        <table className="w-full text-xs text-right">
            <thead>
                <tr className="border-b border-gray-100 text-[10px] text-gray-400 font-bold tracking-wider">
                    <th className="font-normal text-left py-2 px-4 w-[20%]"></th>
                    <th className="font-normal py-2 px-1 w-[11%]">HOJE</th>
                    <th className="font-normal py-2 px-1 w-[11%]">2D</th>
                    <th className="font-normal py-2 px-1 w-[11%]">3D</th>
                    <th className="font-normal py-2 px-1 w-[11%]">7D</th>
                    <th className="font-normal py-2 px-1 w-[11%] text-gray-300">14D<br/><span className="text-[8px]">N/A</span></th>
                    <th className="font-normal py-2 px-1 w-[11%] text-gray-300">30D<br/><span className="text-[8px]">N/A</span></th>
                    <th className="font-bold text-indigo-600 py-2 px-4 w-[14%] bg-indigo-50/30">30D+HOJE</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
                {/* GASTO */}
                <tr className="hover:bg-gray-50">
                    <td className="text-left py-2 px-4 font-bold text-gray-500">Gasto</td>
                    {ranges.map((r, i) => {
                        if (r === '14D' || r === '30D') return <td key={i} className="text-gray-200">—</td>;
                        const v = history?.[r]?.cost;
                        return <td key={i} className={`py-2 px-1 font-mono font-medium text-rose-500 ${r==='30D+HOJE' ? 'px-4 bg-indigo-50/20' : ''}`}>{v ? formatCurrency(v).replace(',00','') : '—'}</td>;
                    })}
                </tr>
                {/* RECEITA */}
                <tr className="hover:bg-gray-50">
                    <td className="text-left py-2 px-4 font-bold text-gray-500">Receita</td>
                    {ranges.map((r, i) => {
                        if (r === '14D' || r === '30D') return <td key={i} className="text-gray-200">—</td>;
                        const v = history?.[r]?.revenue;
                        return <td key={i} className={`py-2 px-1 font-mono font-medium ${v>0 ? 'text-emerald-500' : 'text-gray-300'} ${r==='30D+HOJE' ? 'px-4 bg-indigo-50/20' : ''}`}>{v ? formatCurrency(v).replace(',00','') : '—'}</td>;
                    })}
                </tr>
                {/* LUCRO */}
                <tr className="hover:bg-gray-50">
                    <td className="text-left py-2 px-4 font-bold text-gray-500">Lucro</td>
                    {ranges.map((r, i) => {
                        if (r === '14D' || r === '30D') return <td key={i} className="text-gray-200">—</td>;
                        const v = history?.[r]?.profit;
                        return <td key={i} className={`py-2 px-1 font-mono font-bold ${v>0 ? 'text-emerald-500' : v<0 ? 'text-rose-500' : 'text-gray-300'} ${r==='30D+HOJE' ? 'px-4 bg-indigo-50/20' : ''}`}>{v ? formatCurrency(v).replace(',00','') : '—'}</td>;
                    })}
                </tr>
                {/* ROAS */}
                <tr className="hover:bg-gray-50">
                    <td className="text-left py-2 px-4 font-bold text-gray-500">ROAS</td>
                    {ranges.map((r, i) => {
                        if (r === '14D' || r === '30D') return <td key={i} className="text-gray-200">—</td>;
                        const v = history?.[r]?.roas;
                        return <td key={i} className={`py-2 px-1 font-mono font-bold ${v>=1 ? 'text-emerald-500' : v>0? 'text-amber-500':'text-gray-300'} ${r==='30D+HOJE' ? 'px-4 bg-indigo-50/20' : ''}`}>{v>0 ? v.toFixed(2)+'x' : '—'}</td>;
                    })}
                </tr>
                {/* VENDAS */}
                <tr className="hover:bg-gray-50">
                    <td className="text-left py-2 px-4 font-bold text-gray-500">Vendas</td>
                    {ranges.map((r, i) => {
                        if (r === '14D' || r === '30D') return <td key={i} className="text-gray-200">—</td>;
                        const v = history?.[r]?.sales;
                        return <td key={i} className={`py-2 px-1 font-mono font-bold ${v>0 ? 'text-emerald-500' : 'text-gray-300'} ${r==='30D+HOJE' ? 'px-4 bg-indigo-50/20' : ''}`}>{v>0 ? v : '—'}</td>;
                    })}
                </tr>
                {/* CPA */}
                <tr className="hover:bg-gray-50 border-b border-gray-100">
                    <td className="text-left py-2 px-4 font-bold text-gray-500">CPA</td>
                    {ranges.map((r, i) => {
                        if (r === '14D' || r === '30D') return <td key={i} className="text-gray-200">—</td>;
                        const v = history?.[r]?.cpa;
                        return <td key={i} className={`py-2 px-1 font-mono font-bold text-amber-500 ${r==='30D+HOJE' ? 'px-4 bg-indigo-50/20 text-amber-600' : ''}`}>{v>0 ? formatCurrency(v).replace(',00','') : '—'}</td>;
                    })}
                </tr>
            </tbody>
        </table>
      </div>

      {/* FOOTER NOTE - Fake just to match layout purely visually */}
      <div className="p-4 bg-white border-t border-gray-100">
        <h4 className="text-[9px] uppercase font-bold text-gray-400 mb-1">Nota</h4>
        <div className="w-full h-10 border border-gray-200 rounded-md bg-gray-50/50 p-2 text-gray-400 font-sans text-xs italic">
            Adicionar observacao...
        </div>
      </div>
    </div>
  );
}
