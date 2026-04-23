'use client';

import { useState, useTransition } from 'react';
import Select, { MultiValue } from 'react-select';
import { setRtCampaignSelections } from '../actions';
import { RefreshCw } from 'lucide-react';

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface Campaign {
  campaign_id: string;
  campaign_name: string;
  status: string;
  is_selected: boolean;
}

interface CampaignOption {
  value: string;
  label: string;
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
    <div className="w-full bg-gray-100 rounded-full h-1.5">
      <div className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
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

function StreamLog({ lines }: { lines: LogLine[] }) {
  const scrollRef = (el: HTMLDivElement | null) => {
    if (el) el.scrollTop = el.scrollHeight;
  };
  return (
    <div className="border border-gray-100 rounded-lg overflow-hidden">
      <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider px-4 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
        <span>Status</span>
        <span className="text-gray-300">{lines.length} evento(s)</span>
      </div>
      <div ref={scrollRef} className="max-h-64 overflow-y-auto bg-gray-900 text-gray-100 font-mono text-[11px] leading-relaxed px-3 py-2 whitespace-pre-wrap">
        {lines.map((l, i) => {
          const color =
            l.level === 'error' ? 'text-rose-400' :
            l.level === 'warn'  ? 'text-amber-300' :
            'text-gray-100';
          const ts = l.ts ? new Date(l.ts).toLocaleTimeString() : '';
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
// Painel Meta
// ═══════════════════════════════════════════════════════════════════════════════
type MetaPeriod = 7 | 14 | 30 | 60 | 90 | 'yesterday' | 'range';

function MetaPanel() {
  const [period, setPeriod] = useState<MetaPeriod>(30);
  const todayStr = new Date().toISOString().slice(0, 10);
  const weekAgoStr = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
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
        <span className="text-xs text-gray-600 font-medium whitespace-nowrap">Período:</span>
        <div className="flex gap-1 flex-wrap">
          {([7, 14, 30, 60, 90] as const).map(d => (
            <button key={d} onClick={() => setPeriod(d)} disabled={running}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors disabled:opacity-40 ${
                period === d ? 'bg-indigo-600 text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >{d}d</button>
          ))}
          <button onClick={() => setPeriod('yesterday')} disabled={running}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors disabled:opacity-40 ${
              period === 'yesterday' ? 'bg-indigo-600 text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >Ontem</button>
          <button onClick={() => setPeriod('range')} disabled={running}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors disabled:opacity-40 ${
              period === 'range' ? 'bg-indigo-600 text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >Datas específicas</button>
        </div>
        <button onClick={handleSync} disabled={running || !rangeValid}
          className="ml-auto flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {running
            ? <><SpinIcon /> Importando...</>
            : <><UploadIcon /> {
                period === 'yesterday' ? 'Importar ontem' :
                period === 'range'     ? 'Importar datas' :
                                         `Importar ${period} dias`
              }</>}
        </button>
      </div>

      {period === 'range' && (
        <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-gray-500 font-medium">De</label>
            <input type="date" value={rangeFrom} max={todayStr}
              onChange={e => setRangeFrom(e.target.value)} disabled={running}
              className="text-xs px-2 py-1 rounded-md border border-gray-200 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none disabled:opacity-50"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-gray-500 font-medium">Até</label>
            <input type="date" value={rangeTo} max={todayStr}
              onChange={e => setRangeTo(e.target.value)} disabled={running}
              className="text-xs px-2 py-1 rounded-md border border-gray-200 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none disabled:opacity-50"
            />
          </div>
          {!rangeValid && (
            <span className="text-[11px] text-rose-500 font-medium">Intervalo inválido</span>
          )}
        </div>
      )}

      {running && startLine && (
        <div>
          <div className="flex justify-between text-[10px] text-gray-500 mb-1">
            <span>
              {batchStartLine
                ? `Fila ${batchStartLine.batch}/${batchStartLine.totalBatches} (${batchStartLine.batchSize} contas) — ${progressLine?.account ?? 'processando...'}`
                : `Iniciando ${startLine.total} contas...`}
            </span>
            <span>{progressPct}%</span>
          </div>
          <ProgressBar pct={progressPct} />
          {batchStartLine && (
            <div className="text-[10px] text-gray-400 mt-1">
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
              {line.status === 'ok'    && <span className="text-gray-500">{line.rows?.toLocaleString('pt-BR')} linhas</span>}
              {line.status === 'empty' && <span className="text-gray-400">sem dados</span>}
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
  // ── Seletor de campanhas ──────────────────────────────────────────────────
  const allOptions: CampaignOption[] = initialCampaigns.map(c => ({
    value: c.campaign_id,
    label: c.campaign_name,
  }));

  const [selected, setSelected] = useState<MultiValue<CampaignOption>>(
    allOptions.filter(o => initialCampaigns.find(c => c.campaign_id === o.value)?.is_selected)
  );
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [isScanningCamps, setIsScanningCamps] = useState(false);

  const handleSelectChange = (newValue: MultiValue<CampaignOption>) => {
    setSelected(newValue);
    setSaved(false);
    startTransition(async () => {
      try {
        await setRtCampaignSelections(newValue.map(o => o.value));
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch { /* silently fail */ }
    });
  };

  const scanCampaigns = async () => {
    setIsScanningCamps(true);
    try {
      const res = await fetch('/api/accounts/sync');
      const data = await res.json();
      if (data.success) window.location.reload();
      else alert('Erro: ' + data.error);
    } catch (e: any) { alert('Erro de rede: ' + (e?.message ?? String(e))); }
    finally { setIsScanningCamps(false); }
  };

  // ── Sync ──────────────────────────────────────────────────────────────────
  type RtPeriod = 'today' | 'yesterday' | 'days3' | 'days7' | 'range';
  const [period, setPeriod] = useState<RtPeriod>('today');
  const todayStr = new Date().toISOString().slice(0, 10);
  const weekAgoStr = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
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

      {/* ── Seletor ── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-700">Campanhas selecionadas</p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {selected.length} de {allOptions.length} campanha(s)
            </p>
          </div>
          <div className="flex items-center gap-2">
            {(isPending || saved) && (
              <span className={`text-[11px] font-medium ${saved ? 'text-emerald-600' : 'text-gray-400'}`}>
                {saved ? '✓ Salvo' : 'Salvando...'}
              </span>
            )}
            <button onClick={scanCampaigns} disabled={isScanningCamps}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`w-3 h-3 ${isScanningCamps ? 'animate-spin' : ''}`} />
              {isScanningCamps ? 'Escaneando...' : 'Escanear'}
            </button>
          </div>
        </div>

        <Select<CampaignOption, true>
          instanceId="select-meta-campaigns-settings"
          isMulti
          options={allOptions}
          value={selected}
          onChange={handleSelectChange}
          placeholder="Pesquise e selecione campanhas..."
          noOptionsMessage={() => 'Nenhuma campanha encontrada'}
          isLoading={isPending}
          closeMenuOnSelect={false}
          hideSelectedOptions={false}
          styles={{
            control: (base, state) => ({
              ...base,
              minHeight: '40px',
              borderRadius: '0.5rem',
              borderColor: state.isFocused ? '#6366f1' : '#e5e7eb',
              boxShadow: state.isFocused ? '0 0 0 1px #6366f1' : 'none',
              backgroundColor: '#f9fafb',
              fontSize: '12px',
            }),
            menu: (base) => ({ ...base, borderRadius: '0.5rem', boxShadow: '0 4px 24px rgba(0,0,0,0.10)', border: '1px solid #e5e7eb', zIndex: 50 }),
            option: (base, state) => ({
              ...base, fontSize: '12px',
              backgroundColor: state.isSelected ? '#eef2ff' : state.isFocused ? '#f5f5f5' : 'white',
              color: state.isSelected ? '#4338ca' : '#374151',
              fontWeight: state.isSelected ? 600 : 400,
            }),
            multiValue:       (base) => ({ ...base, backgroundColor: '#eef2ff', borderRadius: '0.375rem' }),
            multiValueLabel:  (base) => ({ ...base, color: '#4338ca', fontSize: '11px', fontWeight: 600 }),
            multiValueRemove: (base) => ({ ...base, color: '#6366f1', ':hover': { backgroundColor: '#c7d2fe', color: '#4338ca' } }),
            placeholder:      (base) => ({ ...base, fontSize: '12px', color: '#9ca3af' }),
          }}
        />

        {selected.length > 0 && (
          <div className="flex justify-end">
            <button onClick={() => handleSelectChange([])}
              className="text-[11px] text-rose-500 hover:text-rose-700 font-medium transition-colors"
            >
              Limpar seleção
            </button>
          </div>
        )}
      </div>

      {/* ── Divisor ── */}
      <div className="border-t border-gray-100" />

      {/* ── Seletor de período + datas específicas ── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-gray-600 font-medium whitespace-nowrap">Período:</span>
          <div className="flex gap-1 flex-wrap">
            {([
              ['today',     'Hoje'],
              ['yesterday', 'Ontem'],
              ['days3',     '3 dias'],
              ['days7',     '7 dias'],
              ['range',     'Datas específicas'],
            ] as const).map(([p, label]) => (
              <button key={p} onClick={() => setPeriod(p)} disabled={running}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors disabled:opacity-40 ${
                  period === p ? 'bg-violet-600 text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >{label}</button>
            ))}
          </div>
          <button onClick={handleSync} disabled={running || selected.length === 0 || !rangeValid}
            className="ml-auto flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {running ? <><SpinIcon /> Sincronizando...</> : <><UploadIcon /> {buttonLabel}</>}
          </button>
        </div>

        {period === 'range' && (
          <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-gray-500 font-medium">De</label>
              <input type="date" value={rangeFrom} max={todayStr}
                onChange={e => setRangeFrom(e.target.value)} disabled={running}
                className="text-xs px-2 py-1 rounded-md border border-gray-200 bg-white focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none disabled:opacity-50"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-gray-500 font-medium">Até</label>
              <input type="date" value={rangeTo} max={todayStr}
                onChange={e => setRangeTo(e.target.value)} disabled={running}
                className="text-xs px-2 py-1 rounded-md border border-gray-200 bg-white focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none disabled:opacity-50"
              />
            </div>
            {!rangeValid && (
              <span className="text-[11px] text-rose-500 font-medium">Intervalo inválido</span>
            )}
          </div>
        )}

        <p className="text-[11px] text-gray-500">
          Sincroniza <span className="font-semibold text-gray-700">{
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
          <div className="flex justify-between text-[10px] text-gray-500 mb-1">
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
              {line.status === 'ok' && <span className="text-gray-500">{line.rtAds} rt_ads · {line.rtCampaigns} rt_campaigns</span>}
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
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
        <div className="mb-4">
          <h2 className="text-sm font-bold text-gray-800">Importar histórico — Meta Ads</h2>
          <p className="text-xs text-gray-500 mt-1">
            Busca dados diários de todas as contas selecionadas e armazena no banco.
          </p>
        </div>
        <MetaPanel />
      </div>

      {/* RedTrack */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
        <div className="mb-4">
          <h2 className="text-sm font-bold text-gray-800">Importar histórico — RedTrack</h2>
          <p className="text-xs text-gray-500 mt-1">
            Selecione as campanhas e sincronize os dados no cache do banco.
          </p>
        </div>
        <RedTrackPanel initialCampaigns={initialRtCampaigns} />
      </div>

    </div>
  );
}
