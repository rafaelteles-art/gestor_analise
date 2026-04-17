'use client';

import { useState } from 'react';

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface LogLine {
  type: string;
  account?: string;
  rows?: number;
  status?: 'ok' | 'empty' | 'error';
  error?: string;
  index?: number;
  total?: number;
  totalRows?: number;
  errorCount?: number;
  accounts?: number;
  dateFrom?: string;
  dateTo?: string;
  days?: number;
}

// ── Helpers UI ────────────────────────────────────────────────────────────────
function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="w-full bg-gray-100 rounded-full h-1.5">
      <div className="bg-fuchsia-500 h-1.5 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
    </div>
  );
}

function StatusBanner({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg text-xs font-medium ${
      ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
         : 'bg-amber-50 border border-amber-200 text-amber-700'
    }`}>
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>{children}</span>
    </div>
  );
}

function SyncLog({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-gray-100 rounded-lg overflow-hidden">
      <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider px-4 py-2 bg-gray-50 border-b border-gray-100">Log</div>
      <div className="divide-y divide-gray-50 max-h-56 overflow-y-auto">{children}</div>
    </div>
  );
}

function LogRow({ label, status, children }: { label: string; status?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-2 text-xs">
      <span className="text-gray-700 font-medium truncate max-w-[55%]">{label}</span>
      <div className="flex items-center gap-2 shrink-0">
        {children}
        {status === 'ok'    && <span className="text-emerald-500 text-base leading-none">✓</span>}
        {status === 'error' && <span className="text-rose-500 text-base leading-none">✗</span>}
      </div>
    </div>
  );
}

function SpinIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={`h-3.5 w-3.5 animate-spin ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
    </svg>
  );
}

// ── Streaming helper ──────────────────────────────────────────────────────────
async function readNdjsonStream(res: Response, onLine: (line: LogLine) => void) {
  if (!res.body) return;
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
      if (part.trim()) try { onLine(JSON.parse(part)); } catch { /* ignora */ }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Painel vturb
// ═══════════════════════════════════════════════════════════════════════════════
type VturbPeriod = 7 | 14 | 30 | 60 | 90 | 'yesterday';

export default function VturbSyncPanel() {
  const [period, setPeriod] = useState<VturbPeriod>(30);
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [done, setDone] = useState(false);

  const append = (line: LogLine) => setLines(prev => [...prev, line]);

  const handleSync = async () => {
    setRunning(true); setDone(false); setLines([]);
    try {
      const payload = period === 'yesterday' ? { mode: 'yesterday' } : { days: period };
      const res = await fetch('/api/sync/vturb-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        append({ type: 'error', error: (await res.json().catch(() => ({}))).error ?? res.statusText });
        return;
      }
      await readNdjsonStream(res, append);
      setDone(true);
    } catch (err: any) {
      append({ type: 'error', error: err.message });
    } finally {
      setRunning(false);
    }
  };

  const startLine    = lines.find(l => l.type === 'start');
  const doneLine     = lines.find(l => l.type === 'done');
  const progressLine = lines.filter(l => l.type === 'progress').slice(-1)[0];
  const accountLines = lines.filter(l => l.type === 'account_done');
  const errorLine    = lines.find(l => l.type === 'error');
  const progressPct  = progressLine && startLine
    ? Math.round(((progressLine.index ?? 0) / (startLine.total ?? 1)) * 100) : 0;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
      <div className="mb-4">
        <h2 className="text-sm font-bold text-gray-800">Importar histórico — vturb Analytics</h2>
        <p className="text-xs text-gray-500 mt-1">
          Busca dados diários de todos os players via API oficial do vturb e grava em <code className="text-[10px] px-1 py-0.5 bg-gray-100 rounded">vturb_metrics</code>.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-600 font-medium whitespace-nowrap">Período:</span>
          <div className="flex gap-1">
            {([7, 14, 30, 60, 90] as const).map(d => (
              <button key={d} onClick={() => setPeriod(d)} disabled={running}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors disabled:opacity-40 ${
                  period === d ? 'bg-fuchsia-600 text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >{d}d</button>
            ))}
            <button onClick={() => setPeriod('yesterday')} disabled={running}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors disabled:opacity-40 ${
                period === 'yesterday' ? 'bg-fuchsia-600 text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >Ontem</button>
          </div>
          <button onClick={handleSync} disabled={running}
            className="ml-auto flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-fuchsia-600 text-white hover:bg-fuchsia-700 disabled:opacity-50 transition-colors"
          >
            {running
              ? <><SpinIcon /> Importando...</>
              : <><UploadIcon /> {period === 'yesterday' ? 'Importar ontem' : `Importar ${period} dias`}</>}
          </button>
        </div>

        {running && startLine && (
          <div>
            <div className="flex justify-between text-[10px] text-gray-500 mb-1">
              <span>{progressLine ? `Processando: ${progressLine.account}` : `Iniciando ${startLine.total} player(s)...`}</span>
              <span>{progressPct}%</span>
            </div>
            <ProgressBar pct={progressPct} />
          </div>
        )}

        {errorLine && !running && (
          <StatusBanner ok={false}>
            Erro: {errorLine.error}
          </StatusBanner>
        )}

        {done && doneLine && (
          <StatusBanner ok={doneLine.errorCount === 0}>
            {doneLine.totalRows?.toLocaleString('pt-BR')} linhas salvas em {doneLine.accounts} player(s)
            {doneLine.errorCount! > 0 && ` · ${doneLine.errorCount} erro(s)`}
            {' · '}{doneLine.dateFrom} → {doneLine.dateTo}
          </StatusBanner>
        )}

        {accountLines.length > 0 && (
          <SyncLog>
            {accountLines.map((line, i) => (
              <LogRow key={i} label={line.account ?? ''} status={line.status}>
                {line.status === 'ok'    && <span className="text-gray-500">{line.rows?.toLocaleString('pt-BR')} linhas</span>}
                {line.status === 'empty' && <span className="text-gray-400">sem dados</span>}
                {line.status === 'error' && <span className="text-rose-500 text-[10px] truncate max-w-[200px]" title={line.error}>erro: {line.error}</span>}
              </LogRow>
            ))}
          </SyncLog>
        )}
      </div>
    </div>
  );
}
