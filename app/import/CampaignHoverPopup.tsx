'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { globalHoverCache, cacheKey } from './hoverCache';
import {
  CreativeDiagnostic,
  CreativeCategory,
  RecoveryVerdict,
  RecoverySignalType,
} from '../analise/diagnostics';

interface PopupProps {
  x: number;
  y: number;
  groupData: any;
  accountId: string;
  rtCampaignId: string;
  /** Diagnóstico computado pela análise da conta (categoria, veredicto, sinais). */
  diagnostic: CreativeDiagnostic | null;
  onMouseLeave: () => void;
  onMouseEnter: () => void;
}

// ============================================================
// Styles de categoria + veredicto
// ============================================================
type BadgeStyle = { label: string; bg: string; text: string; border: string; dot: string };

const CATEGORY_BADGE: Record<CreativeCategory, BadgeStyle> = {
  winner:         { label: 'ESCALAR',    bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  promise:        { label: 'VALIDAR',    bg: 'bg-sky-50',     text: 'text-sky-700',     border: 'border-sky-200',     dot: 'bg-sky-500' },
  stable:         { label: 'MANTER',     bg: 'bg-gray-50',    text: 'text-gray-600',    border: 'border-gray-200',    dot: 'bg-gray-400' },
  underperformer: { label: 'MONITORAR',  bg: 'bg-amber-50',   text: 'text-amber-600',   border: 'border-amber-200',   dot: 'bg-amber-500' },
  loser:          { label: 'PAUSAR',     bg: 'bg-rose-50',    text: 'text-rose-600',    border: 'border-rose-200',    dot: 'bg-rose-500' },
  zombie:         { label: 'PAUSAR',     bg: 'bg-slate-100',  text: 'text-slate-700',   border: 'border-slate-300',   dot: 'bg-slate-500' },
};

const VERDICT_BADGE: Record<RecoveryVerdict, BadgeStyle> = {
  pause:   { label: 'PAUSAR',    bg: 'bg-rose-50',    text: 'text-rose-600',    border: 'border-rose-200',    dot: 'bg-rose-500' },
  observe: { label: 'OBSERVAR',  bg: 'bg-amber-50',   text: 'text-amber-600',   border: 'border-amber-200',   dot: 'bg-amber-500' },
  rescue:  { label: 'RESGATAR',  bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
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

// ============================================================
// Helpers
// ============================================================
const formatCurrency = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Decide o badge principal (topo-direita). Prioriza veredicto de recuperação quando presente. */
function pickStatusBadge(diag: CreativeDiagnostic | null): BadgeStyle {
  if (!diag) return { label: 'ANALISANDO', bg: 'bg-gray-50', text: 'text-gray-400', border: 'border-gray-200', dot: 'bg-gray-300' };
  if (diag.recovery && (['zombie', 'loser', 'underperformer'] as CreativeCategory[]).includes(diag.category)) {
    return VERDICT_BADGE[diag.recovery.verdict];
  }
  return CATEGORY_BADGE[diag.category];
}

/** Frase curta para o painel de inteligência. */
function buildIntelligenceText(diag: CreativeDiagnostic | null, roas7d: number | undefined): string {
  const roas7dStr = roas7d !== undefined && roas7d > 0 ? `${roas7d.toFixed(2)}x` : 'sem dados';
  if (!diag) return `ROAS 7d: ${roas7dStr}.`;
  if (diag.recovery && (['zombie', 'loser', 'underperformer'] as CreativeCategory[]).includes(diag.category)) {
    return `ROAS 7d: ${roas7dStr}. ${diag.recovery.verdict_reason}`;
  }
  // Mensagem por categoria (não ruim)
  switch (diag.category) {
    case 'winner':  return `ROAS 7d: ${roas7dStr}. Criativo vencedor — duplicar em novos conjuntos.`;
    case 'promise': return `ROAS 7d: ${roas7dStr}. Teste inicial promissor — abrir 1–2 conjuntos novos para acelerar validação.`;
    case 'stable':  return `ROAS 7d: ${roas7dStr}. Estável — manter e monitorar tendência.`;
    default:        return `ROAS 7d: ${roas7dStr}.`;
  }
}

/** Calcula número de conjuntos (meta_campaigns) com gasto recente > 0. */
function countActiveSets(groupData: any): number {
  if (!groupData?.meta_campaigns) return 0;
  return groupData.meta_campaigns.filter((mc: any) => (mc.spend || 0) > 0).length;
}

/** Derivar "ATIVO" baseado em gasto nos últimos 2 dias do history + presença de conjuntos com spend > 0. */
function isActive(history: any, groupData: any): boolean {
  const recentCost = (history?.Hoje?.cost || 0) + (history?.['2D']?.cost || 0);
  if (recentCost > 0) return true;
  // Fallback: se não temos history ainda, olha o próprio group (pode ser período mais longo)
  return countActiveSets(groupData) > 0 && (groupData?.cost || 0) > 0;
}

/** Estima idade em dias dentro da janela 30D (dias com gasto). */
function estimateDaysActive(history: any): number | null {
  if (!history) return null;
  let days = 0;
  if ((history.Hoje?.cost || 0) > 0) days++;
  if ((history['2D']?.cost || 0) > (history.Hoje?.cost || 0)) days++;
  if ((history['3D']?.cost || 0) > (history['2D']?.cost || 0)) days++;
  if ((history['7D']?.cost || 0) > (history['3D']?.cost || 0)) days += 4;
  if ((history['30D+HOJE']?.cost || 0) > (history['7D']?.cost || 0)) days += 23;
  return days > 0 ? days : null;
}

/** Tendência: compara ROAS 7d vs 30d+hoje. */
type Trend = { label: string; arrow: string; bg: string; text: string; border: string };
function computeTrend(history: any): Trend {
  const r7 = history?.['7D']?.roas || 0;
  const r30 = history?.['30D+HOJE']?.roas || 0;
  if (!r7 || !r30) return { label: 'Estável', arrow: '→', bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-200' };
  const ratio = r7 / r30;
  if (ratio < 0.8)  return { label: 'Caindo',  arrow: '↘', bg: 'bg-rose-50',    text: 'text-rose-600',    border: 'border-rose-100' };
  if (ratio > 1.2)  return { label: 'Subindo', arrow: '↗', bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-100' };
  return { label: 'Estável', arrow: '→', bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-200' };
}

/** Confiança baseada no volume total gasto (quanto mais dado, mais confiança). */
function computeConfidence(cost: number): string {
  if (cost >= 5000) return 'Alta';
  if (cost >= 1500) return 'Média';
  return 'Baixa';
}

// ============================================================
// Componente
// ============================================================
export default function CampaignHoverPopup({
  x, y, groupData, accountId, rtCampaignId, diagnostic,
  onMouseLeave, onMouseEnter,
}: PopupProps) {
  const [history, setHistory] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function fetchHistory() {
      const key = cacheKey(groupData.rt_ad, accountId, rtCampaignId);

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
          }),
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

  const ranges = ['Hoje', '2D', '3D', '7D', '14D', '30D', '30D+HOJE'];

  // Posicionamento do popup
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1000;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  let finalX = x + 15;
  let finalY = y + 15;
  if (finalX + 600 > vw) finalX = x - 615;
  if (finalY + 400 > vh) finalY = y - 415;
  finalX = Math.max(10, finalX);
  finalY = Math.max(10, finalY);

  // ============================================================
  // Dados de inteligência (derivados)
  // ============================================================
  const statusBadge = pickStatusBadge(diagnostic);
  const activeSetsCount = countActiveSets(groupData);
  const active = useMemo(() => isActive(history, groupData), [history, groupData]);
  const daysActive = useMemo(() => estimateDaysActive(history), [history]);
  const trend = useMemo(() => computeTrend(history), [history]);
  const confidence = useMemo(() => computeConfidence(diagnostic?.cost ?? groupData?.cost ?? 0), [diagnostic, groupData]);
  const intelligenceText = buildIntelligenceText(diagnostic, history?.['7D']?.roas);

  return (
    <div
      className="fixed z-[9999] bg-white rounded-xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.2)] border border-gray-200 w-[600px] flex flex-col font-sans overflow-hidden transform transition-opacity duration-150"
      style={{ left: finalX, top: finalY }}
      onMouseLeave={onMouseLeave}
      onMouseEnter={onMouseEnter}
    >
      {/* ============================================================
          HEADER
          ============================================================ */}
      <div className="p-4 flex flex-col gap-2 border-b border-gray-100">
        <div className="flex justify-between items-start gap-4">
          <h3 className="font-bold text-gray-800 text-[13px] leading-snug break-all">{groupData.rt_ad}</h3>
          <div
            className={`flex-shrink-0 ${statusBadge.bg} ${statusBadge.text} border ${statusBadge.border} text-[10px] uppercase font-bold px-2 py-0.5 rounded-md flex items-center gap-1`}
            title={diagnostic?.recovery?.verdict_reason || diagnostic?.reason || ''}
          >
            <div className={`w-1.5 h-1.5 ${statusBadge.dot} rounded-full`} />
            {statusBadge.label}
          </div>
        </div>

        {/* Chips de contexto */}
        <div className="flex items-center gap-2 text-[10px] font-bold text-gray-400 mt-1 uppercase flex-wrap">
          {daysActive !== null && (
            <span className="border border-gray-200 px-1.5 py-0.5 rounded text-gray-500 bg-gray-50">
              Idade: ~{daysActive}d
            </span>
          )}
          <span className="border border-gray-200 px-1.5 py-0.5 rounded text-gray-500 bg-gray-50">
            {activeSetsCount} conj{activeSetsCount !== 1 ? 's' : ''}
          </span>
          {active ? (
            <span className="border border-emerald-200 px-1.5 py-0.5 rounded text-emerald-600 bg-emerald-50 flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
              ATIVO
            </span>
          ) : (
            <span className="border border-gray-200 px-1.5 py-0.5 rounded text-gray-500 bg-gray-50 flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-gray-400 rounded-full" />
              PARADO
            </span>
          )}
        </div>

        {/* Texto de inteligência */}
        <p className="text-xs text-gray-500 mt-2">
          <span dangerouslySetInnerHTML={{ __html: intelligenceText.replace(/ROAS 7d: ([0-9.,]+x|sem dados)/, 'ROAS 7d: <strong class="font-medium text-gray-700">$1</strong>') }} />
        </p>

        {/* Chips de sinais + tendência + confiança */}
        <div className="flex gap-2 items-center mt-2 flex-wrap">
          {/* Tendência */}
          <span className={`${trend.bg} ${trend.text} border ${trend.border} text-[10px] px-2 py-0.5 rounded shadow-sm font-semibold flex items-center gap-1`}>
            {trend.arrow} {trend.label}
          </span>

          {/* Sinais de recuperação reais (se categoria ruim e sinais detectados) */}
          {diagnostic?.recovery?.signals.map((sig, i) => (
            <span
              key={i}
              className="bg-emerald-50 text-emerald-600 text-[10px] px-2 py-0.5 rounded shadow-sm font-semibold flex items-center gap-1 border border-emerald-100"
              title={sig.detail}
            >
              {SIGNAL_EMOJI[sig.type]} {sig.short}
            </span>
          ))}

          {/* Quando não é categoria ruim, mostrar CTR se for destaque (winner/promise) */}
          {diagnostic && !diagnostic.recovery && diagnostic.ctr > 0 && (
            <span
              className="bg-gray-50 text-gray-600 text-[10px] px-2 py-0.5 rounded shadow-sm font-semibold flex items-center gap-1 border border-gray-100"
              title="Click-through rate do criativo"
            >
              CTR {diagnostic.ctr.toFixed(1)}%
            </span>
          )}

          {/* Quando é ruim sem nenhum sinal, avisa explicitamente */}
          {diagnostic?.recovery && diagnostic.recovery.signals.length === 0 && (
            <span className="bg-rose-50 text-rose-600 text-[10px] px-2 py-0.5 rounded shadow-sm font-semibold flex items-center gap-1 border border-rose-100">
              Sem sinais de recuperação
            </span>
          )}

          <span className="ml-auto border text-gray-400 font-semibold text-[10px] px-2 py-0.5 rounded">
            Confiança: {confidence}
          </span>
        </div>
      </div>

      {/* ============================================================
          MATRIX TABLE (histórico por janela)
          ============================================================ */}
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

      {/* ============================================================
          FOOTER — detalhamento dos sinais (quando existem)
          ============================================================ */}
      {diagnostic?.recovery && diagnostic.recovery.signals.length > 0 && (
        <div className="p-3 bg-gray-50 border-t border-gray-100">
          <h4 className="text-[9px] uppercase font-bold text-gray-400 mb-1.5">Sinais de Recuperação</h4>
          <div className="space-y-1">
            {diagnostic.recovery.signals.map((sig, i) => (
              <div key={i} className="flex items-start gap-1.5 text-[10px] leading-tight">
                <span className="shrink-0">{SIGNAL_EMOJI[sig.type]}</span>
                <div>
                  <strong className="text-gray-700">{sig.label}:</strong>{' '}
                  <span className="text-gray-500">{sig.detail}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
