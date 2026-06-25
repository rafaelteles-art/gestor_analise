'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { todayStr as tzToday, daysAgoStr as tzDaysAgo, fmtTime } from '@/lib/timezone';

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface Campaign {
  campaign_id: string;
  campaign_name: string;
  status: string;
  is_selected: boolean;
}

interface LogLine {
  type: string;
  account?: string;
  rows?: number;
  campaign?: string;
  rtAds?: number;
  rtCampaigns?: number;
  status?: 'ok' | 'empty' | 'error';
  error?: string;
  index?: number;
  total?: number;
  totalRows?: number;
  errorCount?: number;
  synced?: number;
  accounts?: number;
  dateFrom?: string;
  dateTo?: string;
  today?: string;
  days?: number;
  step?: string;
  level?: 'info' | 'warn' | 'error';
  message?: string;
  ts?: number;
  batch?: number;
  totalBatches?: number;
  batchSize?: number;
}

// ── Helpers UI ────────────────────────────────────────────────────────────────
function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="w-full bg-console-surface-2 rounded-full h-1.5">
      <div className="bg-amber-500 h-1.5 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
    </div>
  );
}

function StatusBanner({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg text-xs font-medium ${
      ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-700 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-400'
         : 'bg-amber-50 border border-amber-200 text-amber-700 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-400'
    }`}>
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>{children}</span>
    </div>
  );
}

function StreamLog({ lines }: { lines: LogLine[] }) {
  const scrollRef = (el: HTMLDivElement | null) => {
    if (el) el.scrollTop = el.scrollHeight;
  };
  return (
    <div className="border border-console-border rounded overflow-hidden">
      <div className="text-[10px] text-console-muted font-bold uppercase tracking-wider px-4 py-2 bg-console-surface-2 border-b border-console-border flex items-center justify-between">
        <span>Status</span>
        <span className="text-console-muted">{lines.length} evento(s)</span>
      </div>
      <div ref={scrollRef} className="max-h-64 overflow-y-auto bg-gray-900 text-gray-100 font-mono text-[11px] leading-relaxed px-3 py-2 whitespace-pre-wrap">
        {lines.map((l, i) => {
          const color =
            l.level === 'error' ? 'text-rose-400' :
            l.level === 'warn'  ? 'text-amber-300' :
            'text-gray-100';
          const ts = l.ts ? fmtTime(l.ts) : '';
          return (
            <div key={i} className={color}>
              <span className="text-gray-500">{ts} </span>
              {l.message}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SyncLog({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-console-border rounded overflow-hidden">
      <div className="text-[10px] text-console-muted font-bold uppercase tracking-wider px-4 py-2 bg-console-surface-2 border-b border-console-border">Log</div>
      <div className="divide-y divide-console-border max-h-56 overflow-y-auto">{children}</div>
    </div>
  );
}

function LogRow({ label, status, children }: { label: string; status?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-2 text-xs">
      <span className="text-foreground font-medium truncate max-w-[55%]">{label}</span>
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
// Painel Meta
// ═══════════════════════════════════════════════════════════════════════════════
type MetaPeriod = 7 | 14 | 30 | 60 | 90 | 'today' | 'yesterday' | 'range';

function MetaPanel() {
  const [period, setPeriod] = useState<MetaPeriod>(30);
  const todayStr = tzToday();
  const weekAgoStr = tzDaysAgo(6);
  const [rangeFrom, setRangeFrom] = useState(weekAgoStr);
  const [rangeTo, setRangeTo] = useState(todayStr);
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [done, setDone] = useState(false);

  const append = (line: LogLine) => setLines(prev => [...prev, line]);

  const rangeValid = period !== 'range' || (!!rangeFrom && !!rangeTo && rangeFrom <= rangeTo);

  const handleSync = async () => {
    setRunning(true); setDone(false); setLines([]);
    try {
      const payload =
        period === 'today'     ? { mode: 'today' } :
        period === 'yesterday' ? { mode: 'yesterday' } :
        period === 'range'     ? { mode: 'range', dateFrom: rangeFrom, dateTo: rangeTo } :
                                 { days: period };
      const res = await fetch('/api/sync/meta-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { append({ type: 'error', error: (await res.json().catch(() => ({}))).error ?? res.statusText }); return; }
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
  const batchStartLine = lines.filter(l => l.type === 'batch_start').slice(-1)[0];
  const batchDoneLines = lines.filter(l => l.type === 'batch_done');
  const progressPct  = progressLine && startLine
    ? Math.round(((progressLine.index ?? 0) / (startLine.total ?? 1)) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-foreground font-medium whitespace-nowrap">Período:</span>
        <div className="flex gap-1 flex-wrap">
          {([7, 14, 30, 60, 90] as const).map(d => (
            <button key={d} onClick={() => setPeriod(d)} disabled={running}
              className={`px-3 py-1 text-xs font-semibold rounded transition-colors disabled:opacity-40 ${
                period === d ? 'bg-amber-500 text-black' : 'border border-console-border text-foreground hover:bg-console-surface-2'
              }`}
            >{d}d</button>
          ))}
          <button onClick={() => setPeriod('today')} disabled={running}
            className={`px-3 py-1 text-xs font-semibold rounded transition-colors disabled:opacity-40 ${
              period === 'today' ? 'bg-amber-500 text-black' : 'border border-console-border text-foreground hover:bg-console-surface-2'
            }`}
          >Hoje</button>
          <button onClick={() => setPeriod('yesterday')} disabled={running}
            className={`px-3 py-1 text-xs font-semibold rounded transition-colors disabled:opacity-40 ${
              period === 'yesterday' ? 'bg-amber-500 text-black' : 'border border-console-border text-foreground hover:bg-console-surface-2'
            }`}
          >Ontem</button>
          <button onClick={() => setPeriod('range')} disabled={running}
            className={`px-3 py-1 text-xs font-semibold rounded transition-colors disabled:opacity-40 ${
              period === 'range' ? 'bg-amber-500 text-black' : 'border border-console-border text-foreground hover:bg-console-surface-2'
            }`}
          >Datas específicas</button>
        </div>
        <button onClick={handleSync} disabled={running || !rangeValid}
          className="ml-auto flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded bg-amber-500 text-black hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {running
            ? <><SpinIcon /> Importando...</>
            : <><UploadIcon /> {
                period === 'today'     ? 'Importar hoje' :
                period === 'yesterday' ? 'Importar ontem' :
                period === 'range'     ? 'Importar datas' :
                                         `Importar ${period} dias`
              }</>}
        </button>
      </div>

      {period === 'range' && (
        <div className="flex items-center gap-3 bg-console-surface-2 border border-console-border rounded px-3 py-2 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-console-muted font-medium">De</label>
            <input type="date" value={rangeFrom} max={todayStr}
              onChange={e => setRangeFrom(e.target.value)} disabled={running}
              className="text-xs px-2 py-1 rounded border border-console-border bg-background text-foreground focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none disabled:opacity-50"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-console-muted font-medium">Até</label>
            <input type="date" value={rangeTo} max={todayStr}
              onChange={e => setRangeTo(e.target.value)} disabled={running}
              className="text-xs px-2 py-1 rounded border border-console-border bg-background text-foreground focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none disabled:opacity-50"
            />
          </div>
          {!rangeValid && (
            <span className="text-[11px] text-rose-500 font-medium">Intervalo inválido</span>
          )}
        </div>
      )}

      {running && startLine && (
        <div>
          <div className="flex justify-between text-[10px] text-console-muted mb-1">
            <span>
              {batchStartLine
                ? `Fila ${batchStartLine.batch}/${batchStartLine.totalBatches} (${batchStartLine.batchSize} contas) — ${progressLine?.account ?? 'processando...'}`
                : `Iniciando ${startLine.total} contas...`}
            </span>
            <span>{progressPct}%</span>
          </div>
          <ProgressBar pct={progressPct} />
          {batchStartLine && (
            <div className="text-[10px] text-console-muted mt-1">
              {batchDoneLines.length} de {batchStartLine.totalBatches} filas concluídas
            </div>
          )}
        </div>
      )}

      {done && doneLine && (
        <StatusBanner ok={doneLine.errorCount === 0}>
          {doneLine.totalRows?.toLocaleString('pt-BR')} linhas salvas em {doneLine.accounts} conta(s)
          {doneLine.errorCount! > 0 && ` · ${doneLine.errorCount} erro(s)`}
          {' · '}{doneLine.dateFrom} → {doneLine.dateTo}
        </StatusBanner>
      )}

      {accountLines.length > 0 && (
        <SyncLog>
          {accountLines.map((line, i) => (
            <LogRow key={i} label={line.account ?? ''} status={line.status}>
              {line.status === 'ok'    && <span className="text-console-muted">{line.rows?.toLocaleString('pt-BR')} linhas</span>}
              {line.status === 'empty' && <span className="text-console-muted">sem dados</span>}
              {line.status === 'error' && <span className="text-rose-500 text-[10px] truncate max-w-[200px]" title={line.error}>erro: {line.error}</span>}
            </LogRow>
          ))}
        </SyncLog>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Painel RedTrack — seletor de campanhas + botão de sync num único card
// ═══════════════════════════════════════════════════════════════════════════════
function RedTrackPanel({ initialCampaigns }: { initialCampaigns: Campaign[] }) {
  const campaignCount = initialCampaigns.length;
  const [isScanningCamps, setIsScanningCamps] = useState(false);

  // A rota /api/accounts/sync-rt responde em NDJSON; drena o stream e olha o último evento.
  const scanCampaigns = async () => {
    setIsScanningCamps(true);
    try {
      const res = await fetch('/api/accounts/sync-rt');
      if (!res.ok) { alert('Erro: HTTP ' + res.status); return; }
      let last: LogLine | null = null;
      await readNdjsonStream(res, (line) => { last = line; });
      if (last && (last as LogLine).type === 'done' && (last as any).success) {
        window.location.reload();
      } else if (last && (last as LogLine).type === 'error') {
        alert('Erro: ' + ((last as LogLine).error ?? 'desconhecido'));
      } else {
        alert('Erro: resposta inesperada do servidor.');
      }
    } catch (e: any) { alert('Erro de rede: ' + (e?.message ?? String(e))); }
    finally { setIsScanningCamps(false); }
  };

  // ── Sync ──────────────────────────────────────────────────────────────────
  type RtPeriod = 'today' | 'yesterday' | 'days3' | 'days7' | 'range';
  const [period, setPeriod] = useState<RtPeriod>('today');
  const todayStr = tzToday();
  const weekAgoStr = tzDaysAgo(6);
  const [rangeFrom, setRangeFrom] = useState(weekAgoStr);
  const [rangeTo, setRangeTo] = useState(todayStr);
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [done, setDone] = useState(false);

  const append = (line: LogLine) => setLines(prev => [...prev, line]);

  const buildPayload = (): object | null => {
    switch (period) {
      case 'today':     return { mode: 'today' };
      case 'yesterday': return { mode: 'yesterday' };
      case 'days3':     return { mode: 'days', days: 3 };
      case 'days7':     return { mode: 'days', days: 7 };
      case 'range':
        if (!rangeFrom || !rangeTo) return null;
        if (rangeFrom > rangeTo)    return null;
        return { mode: 'range', dateFrom: rangeFrom, dateTo: rangeTo };
    }
  };

  const rangeValid = period !== 'range' || (rangeFrom && rangeTo && rangeFrom <= rangeTo);

  const handleSync = async () => {
    const payload = buildPayload();
    if (!payload) return;
    setRunning(true); setDone(false); setLines([]);
    try {
      const res = await fetch('/api/sync/rt-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { append({ type: 'error', error: (await res.json().catch(() => ({}))).error ?? res.statusText }); return; }
      await readNdjsonStream(res, append);
      setDone(true);
    } catch (err: any) {
      append({ type: 'error', error: err.message });
    } finally {
      setRunning(false);
    }
  };

  const buttonLabel = (() => {
    switch (period) {
      case 'today':     return 'Sincronizar hoje';
      case 'yesterday': return 'Sincronizar ontem';
      case 'days3':     return 'Sincronizar 3 dias';
      case 'days7':     return 'Sincronizar 7 dias';
      case 'range':     return 'Sincronizar datas';
    }
  })();

  const syncStart    = lines.find(l => l.type === 'start');
  const progressLine = lines.filter(l => l.type === 'progress').slice(-1)[0];
  const doneLine     = lines.find(l => l.type === 'done');
  const campLines    = lines.filter(l => l.type === 'campaign_done');
  const streamLogs   = lines.filter(l => l.type === 'log');
  const progressPct  = progressLine
    ? Math.min(100, Math.round(((progressLine.index ?? 0) / (progressLine.total ?? 1)) * 100))
    : 0;

  return (
    <div className="flex flex-col gap-5">

      {/* ── Campanhas mapeadas + scan ── */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-foreground">Campanhas mapeadas</p>
          <p className="text-[11px] text-console-muted mt-0.5">
            {campaignCount} campanha(s) · vinculadas pelas Ofertas
          </p>
        </div>
        <button onClick={scanCampaigns} disabled={isScanningCamps}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded border border-console-border text-foreground hover:bg-console-surface-2 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-3 h-3 ${isScanningCamps ? 'animate-spin' : ''}`} />
          {isScanningCamps ? 'Escaneando...' : 'Escanear'}
        </button>
      </div>

      {/* ── Divisor ── */}
      <div className="border-t border-console-border" />

      {/* ── Seletor de período + datas específicas ── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-foreground font-medium whitespace-nowrap">Período:</span>
          <div className="flex gap-1 flex-wrap">
            {([
              ['today',     'Hoje'],
              ['yesterday', 'Ontem'],
              ['days3',     '3 dias'],
              ['days7',     '7 dias'],
              ['range',     'Datas específicas'],
            ] as const).map(([p, label]) => (
              <button key={p} onClick={() => setPeriod(p)} disabled={running}
                className={`px-3 py-1 text-xs font-semibold rounded transition-colors disabled:opacity-40 ${
                  period === p ? 'bg-violet-600 text-white' : 'border border-console-border text-foreground hover:bg-console-surface-2'
                }`}
              >{label}</button>
            ))}
          </div>
          <button onClick={handleSync} disabled={running || !rangeValid}
            className="ml-auto flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {running ? <><SpinIcon /> Sincronizando...</> : <><UploadIcon /> {buttonLabel}</>}
          </button>
        </div>

        {period === 'range' && (
          <div className="flex items-center gap-3 bg-console-surface-2 border border-console-border rounded px-3 py-2">
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-console-muted font-medium">De</label>
              <input type="date" value={rangeFrom} max={todayStr}
                onChange={e => setRangeFrom(e.target.value)} disabled={running}
                className="text-xs px-2 py-1 rounded border border-console-border bg-background text-foreground focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none disabled:opacity-50"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-console-muted font-medium">Até</label>
              <input type="date" value={rangeTo} max={todayStr}
                onChange={e => setRangeTo(e.target.value)} disabled={running}
                className="text-xs px-2 py-1 rounded border border-console-border bg-background text-foreground focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none disabled:opacity-50"
              />
            </div>
            {!rangeValid && (
              <span className="text-[11px] text-rose-500 font-medium">Intervalo inválido</span>
            )}
          </div>
        )}

        <p className="text-[11px] text-console-muted">
          Sincroniza <span className="font-semibold text-foreground">{
            period === 'today' ? 'hoje' :
            period === 'yesterday' ? 'ontem' :
            period === 'days3' ? 'os últimos 3 dias' :
            period === 'days7' ? 'os últimos 7 dias' :
            'o intervalo selecionado'
          }</span> no cache. Todos os dias selecionados são re-buscados e sobrescritos. Retry automático em caso de rate limit.
        </p>
      </div>

      {/* ── Progresso ── */}
      {(running || done) && syncStart && (
        <div>
          <div className="flex justify-between text-[10px] text-console-muted mb-1">
            <span>
              {done
                ? `Concluído · ${syncStart.total} campanha(s)`
                : progressLine
                  ? `Processando [${progressLine.index}/${progressLine.total}]: ${progressLine.campaign}`
                  : `Sincronizando ${syncStart.total} campanha(s)...`}
            </span>
            <span>{progressPct}%</span>
          </div>
          <ProgressBar pct={progressPct} />
        </div>
      )}

      {done && doneLine && (
        <StatusBanner ok={(doneLine.errorCount ?? 0) === 0}>
          {doneLine.synced} campanha(s) sincronizada(s)
          {(doneLine.errorCount ?? 0) > 0 && ` · ${doneLine.errorCount} erro(s)`}
          {doneLine.today && ` · dia ${doneLine.today}`}
        </StatusBanner>
      )}

      {/* ── Log em streaming ── */}
      {streamLogs.length > 0 && (
        <StreamLog lines={streamLogs} />
      )}

      {campLines.length > 0 && (
        <SyncLog>
          {campLines.map((line, i) => (
            <LogRow key={i} label={line.campaign ?? ''} status={line.status}>
              {line.status === 'ok' && <span className="text-console-muted">{line.rtAds} rt_ads · {line.rtCampaigns} rt_campaigns</span>}
              {line.status === 'error' && <span className="text-rose-500 text-[10px] truncate max-w-[200px]" title={line.error}>erro: {line.error}</span>}
            </LogRow>
          ))}
        </SyncLog>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Export principal — recebe dados do servidor
// ═══════════════════════════════════════════════════════════════════════════════
export default function MetaSyncPanel({ initialRtCampaigns = [] }: { initialRtCampaigns?: Campaign[] }) {
  return (
    <div className="flex flex-col gap-4">

      {/* Meta */}
      <div className="bg-console-surface border border-console-border rounded p-6">
        <div className="mb-4">
          <h2 className="text-sm font-bold text-foreground">Importar histórico — Meta Ads</h2>
          <p className="text-xs text-console-muted mt-1">
            Busca dados diários das contas vinculadas (via Ofertas / Status de Contas) e armazena no banco.
          </p>
        </div>
        <MetaPanel />
      </div>

      {/* RedTrack */}
      <div className="bg-console-surface border border-console-border rounded p-6">
        <div className="mb-4">
          <h2 className="text-sm font-bold text-foreground">Importar histórico — RedTrack</h2>
          <p className="text-xs text-console-muted mt-1">
            Sincroniza os dados das campanhas vinculadas (via Ofertas) no cache do banco.
          </p>
        </div>
        <RedTrackPanel initialCampaigns={initialRtCampaigns} />
      </div>

    </div>
  );
}
