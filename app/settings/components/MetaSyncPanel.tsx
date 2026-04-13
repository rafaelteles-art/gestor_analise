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
  days?: number;
  step?: string;
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
function MetaPanel() {
  const [days, setDays] = useState(30);
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [done, setDone] = useState(false);

  const append = (line: LogLine) => setLines(prev => [...prev, line]);

  const handleSync = async () => {
    setRunning(true); setDone(false); setLines([]);
    try {
      const res = await fetch('/api/sync/meta-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days }),
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
  const progressPct  = progressLine && startLine
    ? Math.round(((progressLine.index ?? 0) / (startLine.total ?? 1)) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-600 font-medium whitespace-nowrap">Período:</span>
        <div className="flex gap-1">
          {[7, 14, 30, 60, 90].map(d => (
            <button key={d} onClick={() => setDays(d)} disabled={running}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors disabled:opacity-40 ${
                days === d ? 'bg-indigo-600 text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >{d}d</button>
          ))}
        </div>
        <button onClick={handleSync} disabled={running}
          className="ml-auto flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {running ? <><SpinIcon /> Importando...</> : <><UploadIcon /> Importar {days} dias</>}
        </button>
      </div>

      {running && startLine && (
        <div>
          <div className="flex justify-between text-[10px] text-gray-500 mb-1">
            <span>{progressLine ? `Processando: ${progressLine.account}` : `Iniciando ${startLine.total} contas...`}</span>
            <span>{progressPct}%</span>
          </div>
          <ProgressBar pct={progressPct} />
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
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [done, setDone] = useState(false);

  const append = (line: LogLine) => setLines(prev => [...prev, line]);

  const handleSync = async () => {
    setRunning(true); setDone(false); setLines([]);
    try {
      const res = await fetch('/api/sync/rt-bulk', { method: 'POST' });
      if (!res.ok) { append({ type: 'error', error: (await res.json().catch(() => ({}))).error ?? res.statusText }); return; }
      await readNdjsonStream(res, append);
      setDone(true);
    } catch (err: any) {
      append({ type: 'error', error: err.message });
    } finally {
      setRunning(false);
    }
  };

  const syncStart    = lines.find(l => l.type === 'start');
  const progressLine = lines.filter(l => l.type === 'progress').slice(-1)[0];
  const doneLine     = lines.find(l => l.type === 'done');
  const campLines    = lines.filter(l => l.type === 'campaign_done');
  const progressPct  = progressLine && syncStart
    ? Math.round(((progressLine.index ?? 0) / (syncStart.total ?? 1)) * 100) : 0;

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

      {/* ── Botão Sincronizar ── */}
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-gray-500">
          Pré-popula <span className="font-semibold text-gray-700">hoje, ontem, 7d, 14d e 30d</span> no cache para cada campanha selecionada.
        </p>
        <button onClick={handleSync} disabled={running || selected.length === 0}
          className="shrink-0 flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {running ? <><SpinIcon /> Sincronizando...</> : <><UploadIcon /> Sincronizar RT</>}
        </button>
      </div>

      {/* ── Progresso ── */}
      {running && syncStart && (
        <div>
          <div className="flex justify-between text-[10px] text-gray-500 mb-1">
            <span>{progressLine ? `Processando: ${progressLine.campaign}` : `Sincronizando ${syncStart.total} campanha(s)...`}</span>
            <span>{progressPct}%</span>
          </div>
          <ProgressBar pct={progressPct} />
        </div>
      )}

      {done && doneLine && (
        <StatusBanner ok={(doneLine.errorCount ?? 0) === 0}>
          {doneLine.synced} campanha(s) sincronizada(s)
          {(doneLine.errorCount ?? 0) > 0 && ` · ${doneLine.errorCount} erro(s)`}
          {' · '}{doneLine.dateFrom} → {doneLine.dateTo}
        </StatusBanner>
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
