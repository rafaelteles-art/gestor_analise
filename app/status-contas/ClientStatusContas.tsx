'use client';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { RefreshCw, PlusCircle, Search, ChevronDown, ChevronRight, X, Tag, User, Check } from 'lucide-react';
import type { AccountSyncStatus } from '@/lib/account-sync';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Account {
  id: string;
  account_id: string;
  account_name: string;
  bm_id: string;
  bm_name: string;
  is_selected: boolean;
  etapa: string;
  gestor: string[];
  oferta_ids: number[];
  cartao: string | null;
  moeda: string;
  limite: number;
  gasto_total: number;
  perfil: string | null;
  account_status: string;
  timezone: string | null;
}

// ─── Account Status Badge ─────────────────────────────────────────────────────

const ACCOUNT_STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  'ACTIVE':                   { label: 'Ativo',           cls: 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400' },
  'DISABLED':                 { label: 'Desabilitado',    cls: 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400' },
  'UNSETTLED':                { label: 'Inadimplente',    cls: 'bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400' },
  'PENDING_REVIEW':           { label: 'Em Revisão',      cls: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-400' },
  'PENDING_CLOSURE':          { label: 'Encerrando',      cls: 'bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400' },
  'IN_GRACE_PERIOD':          { label: 'Carência',        cls: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400' },
  'TEMPORARILY_UNAVAILABLE':  { label: 'Indisponível',    cls: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' },
  'CLOSED':                   { label: 'Encerrada',       cls: 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500' },
  'UNKNOWN':                  { label: 'Desconhecido',    cls: 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500' },
};

function AccountStatusBadge({ status }: { status: string }) {
  const cfg = ACCOUNT_STATUS_LABEL[status] ?? { label: status, cls: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold whitespace-nowrap ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

// ─── Timezone helpers ─────────────────────────────────────────────────────────

function getGmtOffset(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date());
    return parts.find(p => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

// ─── Gestor / Oferta Config ───────────────────────────────────────────────────

const GESTORES = ['RAFAEL', 'KARINE'] as const;


// ─── Etapa Config ─────────────────────────────────────────────────────────────

const ETAPAS = [
  'Não Utilizada',
  'Adicionar Cartão',
  'Subir Aquecimento',
  'Aquecimento',
  'Disponível',
  'Suspenso',
  'Em Análise',
  'Em Uso',
  'Análise Rejeitada',
] as const;

type Etapa = typeof ETAPAS[number];

const ETAPA_STYLE: Record<string, { bg: string; text: string; border: string }> = {
  'Não Utilizada':    { bg: 'bg-gray-100 dark:bg-gray-800',    text: 'text-gray-600 dark:text-gray-300',   border: 'border-gray-200 dark:border-gray-700' },
  'Adicionar Cartão': { bg: 'bg-purple-50 dark:bg-purple-950/40',   text: 'text-purple-700 dark:text-purple-400', border: 'border-purple-200 dark:border-purple-800' },
  'Subir Aquecimento':{ bg: 'bg-amber-50 dark:bg-amber-950/40',    text: 'text-amber-700 dark:text-amber-400',  border: 'border-amber-200 dark:border-amber-800' },
  'Aquecimento':      { bg: 'bg-orange-50 dark:bg-orange-950/40',   text: 'text-orange-700 dark:text-orange-400', border: 'border-orange-200 dark:border-orange-800' },
  'Disponível':       { bg: 'bg-green-50 dark:bg-green-950/40',    text: 'text-green-700 dark:text-green-400',  border: 'border-green-200 dark:border-green-800' },
  'Suspenso':         { bg: 'bg-red-50 dark:bg-red-950/40',      text: 'text-red-700 dark:text-red-400',    border: 'border-red-200 dark:border-red-800' },
  'Em Análise':       { bg: 'bg-yellow-50 dark:bg-yellow-950/40',   text: 'text-yellow-700 dark:text-yellow-400', border: 'border-yellow-200 dark:border-yellow-800' },
  'Em Uso':           { bg: 'bg-blue-50 dark:bg-blue-950/40',     text: 'text-blue-700 dark:text-blue-400',   border: 'border-blue-200 dark:border-blue-800' },
  'Análise Rejeitada':{ bg: 'bg-rose-50 dark:bg-rose-950/40',     text: 'text-rose-700 dark:text-rose-400',   border: 'border-rose-200 dark:border-rose-800' },
};

function getEtapaStyle(etapa: string) {
  return ETAPA_STYLE[etapa] ?? { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-600 dark:text-gray-300', border: 'border-gray-200 dark:border-gray-700' };
}

// ─── Etapa Dropdown ───────────────────────────────────────────────────────────

function EtapaDropdown({
  accountId,
  currentEtapa,
  onUpdate,
}: {
  accountId: string;
  currentEtapa: string;
  onUpdate: (accountId: string, etapa: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isOpen]);

  const s = getEtapaStyle(currentEtapa);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setIsOpen(o => !o)}
        className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border whitespace-nowrap transition-opacity hover:opacity-80 ${s.bg} ${s.text} ${s.border}`}
      >
        {currentEtapa}
        <ChevronDown className="w-3 h-3 opacity-60 shrink-0" />
      </button>

      {isOpen && (
        <div className="absolute z-50 top-full mt-1 left-0 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl py-1 min-w-[185px]">
          {ETAPAS.map(etapa => {
            const es = getEtapaStyle(etapa);
            const active = etapa === currentEtapa;
            return (
              <button
                key={etapa}
                onClick={() => { onUpdate(accountId, etapa); setIsOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${active ? 'font-semibold' : ''}`}
              >
                <span className={`w-3.5 text-indigo-500 shrink-0 ${active ? '' : 'invisible'}`}>✓</span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${es.bg} ${es.text}`}>{etapa}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Field Dropdown (Gestor / Oferta — multi-select) ─────────────────────────

function FieldDropdown({
  accountId,
  field,
  currentValue,
  options,
  placeholder = '—',
  onUpdate,
}: {
  accountId: string;
  field: string;
  currentValue: string[];
  options: readonly { value: string; label: string }[];
  placeholder?: string;
  onUpdate: (accountId: string, field: string, value: string[]) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isOpen]);

  function toggle(optValue: string) {
    const next = currentValue.includes(optValue)
      ? currentValue.filter(v => v !== optValue)
      : [...currentValue, optValue];
    onUpdate(accountId, field, next);
  }

  const LeadingIcon = field === 'oferta' ? Tag : field === 'gestor' ? User : null;
  const isEmpty = currentValue.length === 0;
  const labelText = isEmpty
    ? placeholder
    : currentValue.map(v => options.find(o => o.value === v)?.label ?? v).join(', ');

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setIsOpen(o => !o)}
        className={`flex items-center gap-2 pl-2.5 pr-2 py-1.5 rounded-lg text-xs border bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-700 transition-colors min-w-[130px] max-w-[210px] shadow-sm ${isOpen ? 'border-indigo-400 ring-1 ring-indigo-100' : 'border-gray-200 dark:border-gray-700'}`}
      >
        {LeadingIcon && <LeadingIcon className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 shrink-0" />}
        <span className={`flex-1 truncate text-left ${isEmpty ? 'text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-300 font-medium'}`}>{labelText}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-gray-400 dark:text-gray-500 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute z-50 top-full mt-1 left-0 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl py-1 min-w-[190px] max-h-64 overflow-y-auto">
          {options.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500 italic">Nenhuma opção disponível</p>
          ) : (
            options.map(opt => {
              const active = currentValue.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  onClick={() => toggle(opt.value)}
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${active ? 'font-semibold text-gray-800 dark:text-gray-100' : 'text-gray-600 dark:text-gray-300'}`}
                >
                  <span className={`w-4 h-4 flex items-center justify-center rounded border shrink-0 transition-colors ${active ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-300 dark:border-gray-700'}`}>
                    {active && <Check className="w-3 h-3" strokeWidth={3} />}
                  </span>
                  <span className="truncate">{opt.label}</span>
                </button>
              );
            })
          )}
          {currentValue.length > 0 && (
            <>
              <div className="border-t border-gray-100 dark:border-gray-800 my-1" />
              <button
                onClick={() => { onUpdate(accountId, field, []); setIsOpen(false); }}
                className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-red-50 dark:hover:bg-red-950/40 text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors"
              >
                <X className="w-3 h-3 shrink-0" />
                Limpar tudo
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── New Account Modal ────────────────────────────────────────────────────────

function NewAccountModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    account_id: '',
    account_name: '',
    bm_id: '',
    bm_name: '',
    gestor: '',
    etapa: 'Não Utilizada' as Etapa,
    moeda: 'BRL',
    perfil: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.account_id.trim() || !form.account_name.trim()) {
      setError('ID da conta e nome são obrigatórios.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/status-contas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Erro ao cadastrar conta.');
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, key: keyof typeof form, type = 'text') => (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-gray-500 dark:text-gray-400">{label}</label>
      <input
        type={type}
        value={form[key] as string}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm outline-none focus:border-indigo-400 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <h3 className="font-bold text-gray-800 dark:text-gray-100">Cadastrar Nova Conta</h3>
          <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            {field('ID da Conta Meta *', 'account_id')}
            {field('Nome da Conta *', 'account_name')}
            {field('ID Business Manager', 'bm_id')}
            {field('Nome do BM / Grupo', 'bm_name')}
            {field('Gestor', 'gestor')}
            {field('Perfil', 'perfil')}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-500 dark:text-gray-400">Etapa</label>
              <select
                value={form.etapa}
                onChange={e => setForm(f => ({ ...f, etapa: e.target.value as Etapa }))}
                className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm outline-none focus:border-indigo-400 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              >
                {ETAPAS.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-500 dark:text-gray-400">Moeda</label>
              <select
                value={form.moeda}
                onChange={e => setForm(f => ({ ...f, moeda: e.target.value }))}
                className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm outline-none focus:border-indigo-400 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              >
                <option value="BRL">BRL</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </select>
            </div>
          </div>

          {error && <p className="text-xs text-red-500 font-medium">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors disabled:opacity-50"
            >
              {saving ? 'Salvando...' : 'Cadastrar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Sync Freshness ───────────────────────────────────────────────────────────
//
// Lê o blob last_account_sync (app_settings) e mostra "há X · N contas". Vermelho
// se a última execução falhou ou está obsoleta (>2h) — o Account Sync horário
// deveria mantê-la sempre fresca. Tempo relativo é calculado no cliente (a partir
// de ran_at_ms, epoch absoluto) e re-tickado a cada 60s; um flag `mounted` evita
// mismatch de hidratação.

const STALE_MS = 2 * 60 * 60 * 1000; // 2h

function relativeFromMs(ms: number): string {
  const diff = Math.max(0, Date.now() - ms);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora há pouco';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

function SyncFreshness({ lastSync }: { lastSync: AccountSyncStatus | null }) {
  const [mounted, setMounted] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    setMounted(true);
    const id = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  if (!lastSync) {
    return <span className="text-xs text-gray-400 dark:text-gray-500">Contas nunca sincronizadas automaticamente</span>;
  }

  const stale = !lastSync.ok || (mounted && Date.now() - lastSync.ran_at_ms > STALE_MS);
  const when = mounted ? relativeFromMs(lastSync.ran_at_ms) : '…';
  const dotCls = stale ? 'bg-red-500' : 'bg-green-500';
  const textCls = stale ? 'text-red-500' : 'text-gray-500 dark:text-gray-400';

  return (
    <span className={`flex items-center gap-1.5 text-xs ${textCls}`} title="Última sincronização de contas Meta">
      <span className={`w-1.5 h-1.5 rounded-full ${dotCls}`} />
      {lastSync.ok
        ? <>Sincronizado {when}{typeof lastSync.count === 'number' ? ` · ${lastSync.count} contas` : ''}</>
        : <>Falha na última sincronização ({when})</>}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ClientStatusContas({
  initialAccounts,
  ofertasOptions = [],
  lastSync = null,
}: {
  initialAccounts: Account[];
  ofertasOptions?: { value: string; label: string }[];
  lastSync?: AccountSyncStatus | null;
}) {
  const [accounts, setAccounts] = useState<Account[]>(initialAccounts);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set(initialAccounts.map(a => a.bm_name)));
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());

  const [filterGestor, setFilterGestor] = useState('');
  const [filterOferta, setFilterOferta] = useState('');
  const [filterEtapa, setFilterEtapa] = useState('');
  const [filterMoeda, setFilterMoeda] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCartao, setFilterCartao] = useState('');
  const [search, setSearch] = useState('');

  const [isSyncing, setIsSyncing] = useState(false);
  const [isSyncingStatus, setIsSyncingStatus] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{
    label: string;
    message: string;
    current: number;
    total: number;
    indeterminate: boolean;
  } | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [batchEtapa, setBatchEtapa] = useState('');
  const [isUpdatingBatch, setIsUpdatingBatch] = useState(false);

  // ── Filtered ──
  const filteredAccounts = useMemo(() => {
    return accounts.filter(acc => {
      if (filterGestor === '__NONE__' && acc.gestor.length > 0) return false;
      if (filterGestor && filterGestor !== '__NONE__' && !acc.gestor.includes(filterGestor)) return false;
      if (filterOferta === '__NONE__' && acc.oferta_ids.length > 0) return false;
      if (filterOferta && filterOferta !== '__NONE__' && !acc.oferta_ids.map(String).includes(filterOferta)) return false;
      if (filterEtapa && acc.etapa !== filterEtapa) return false;
      if (filterMoeda && acc.moeda !== filterMoeda) return false;
      if (filterStatus === 'ACTIVE' && acc.account_status !== 'ACTIVE') return false;
      if (filterStatus === 'INACTIVE' && acc.account_status === 'ACTIVE') return false;
      if (filterCartao === 'COM_CARTAO' && !acc.cartao) return false;
      if (filterCartao === 'SEM_CARTAO' && !!acc.cartao) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !acc.account_name.toLowerCase().includes(q) &&
          !acc.account_id.toLowerCase().includes(q) &&
          !(acc.cartao ?? '').toLowerCase().includes(q) &&
          !acc.gestor.join(' ').toLowerCase().includes(q) &&
          !acc.bm_name.toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [accounts, filterGestor, filterOferta, filterEtapa, filterMoeda, filterStatus, filterCartao, search]);

  // ── KPIs ──
  const kpis = useMemo(() => {
    const total = filteredAccounts.length;
    const ativas = filteredAccounts.filter(a => a.account_status === 'ACTIVE').length;
    const desativadas = filteredAccounts.filter(a =>
      ['DISABLED', 'CLOSED', 'PENDING_CLOSURE'].includes(a.account_status)
    ).length;
    const emAnalise = filteredAccounts.filter(a => a.etapa === 'Em Análise').length;
    const gastoTotalByCurrency = filteredAccounts.reduce<Record<string, number>>((map, a) => {
      const cur = a.moeda || 'BRL';
      map[cur] = (map[cur] || 0) + (Number(a.gasto_total) || 0);
      return map;
    }, {});
    return { total, ativas, desativadas, emAnalise, gastoTotalByCurrency };
  }, [filteredAccounts]);

  // ── Groups ──
  const groups = useMemo(() => {
    const map = new Map<string, Account[]>();
    filteredAccounts.forEach(acc => {
      if (!map.has(acc.bm_name)) map.set(acc.bm_name, []);
      map.get(acc.bm_name)!.push(acc);
    });
    return Array.from(map.entries()).map(([name, accs]) => ({ name, accounts: accs }));
  }, [filteredAccounts]);

  const uniqueMoedas = useMemo(() => [...new Set(accounts.map(a => a.moeda).filter(Boolean))], [accounts]);

  // ── Update Etapa ──
  const updateEtapa = useCallback(async (accountId: string, etapa: string) => {
    const prev = accounts.find(a => a.account_id === accountId)?.etapa ?? 'Não Utilizada';
    setAccounts(accs => accs.map(a => a.account_id === accountId ? { ...a, etapa } : a));
    try {
      const res = await fetch('/api/status-contas', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: accountId, field: 'etapa', value: etapa }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setAccounts(accs => accs.map(a => a.account_id === accountId ? { ...a, etapa: prev } : a));
    }
  }, [accounts]);

  // ── Update Field (gestor — arrays) ──
  const updateField = useCallback(async (accountId: string, field: string, value: string[]) => {
    const prev = (accounts.find(a => a.account_id === accountId)?.[field as keyof Account] ?? []) as string[];
    setAccounts(accs => accs.map(a => a.account_id === accountId ? { ...a, [field]: value } : a));
    try {
      const res = await fetch('/api/status-contas', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: accountId, field, value }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setAccounts(accs => accs.map(a => a.account_id === accountId ? { ...a, [field]: prev } : a));
    }
  }, [accounts]);

  // ── Batch Update ──
  const handleBatchUpdate = async () => {
    if (!batchEtapa || selectedAccounts.size === 0) return;
    const ids = Array.from(selectedAccounts);
    setIsUpdatingBatch(true);
    setAccounts(accs => accs.map(a => ids.includes(a.account_id) ? { ...a, etapa: batchEtapa } : a));
    try {
      await fetch('/api/status-contas', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_ids: ids, field: 'etapa', value: batchEtapa }),
      });
      setSelectedAccounts(new Set());
      setBatchEtapa('');
    } catch {
      alert('Erro ao atualizar etapas em lote.');
    } finally {
      setIsUpdatingBatch(false);
    }
  };

  const runStreamedSync = async (url: string, label: string) => {
    setSyncProgress({ label, message: 'Conectando…', current: 0, total: 0, indeterminate: true });

    let success = false;
    let errorMsg: string | null = null;

    try {
      const res = await fetch(url);
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

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
          if (!part.trim()) continue;
          let line: any;
          try { line = JSON.parse(part); } catch { continue; }

          if (line.type === 'start') {
            setSyncProgress({
              label,
              message: line.message ?? 'Iniciando…',
              current: 0,
              total: line.total ?? 0,
              indeterminate: !line.total,
            });
          } else if (line.type === 'progress') {
            setSyncProgress(prev => ({
              label,
              message: line.message ?? prev?.message ?? '',
              current: line.current ?? prev?.current ?? 0,
              total: line.total ?? prev?.total ?? 0,
              indeterminate: line.total == null && !prev?.total,
            }));
          } else if (line.type === 'done') {
            success = !!line.success;
            setSyncProgress(prev => ({
              label,
              message: line.message ?? 'Concluído',
              current: prev?.total ?? prev?.current ?? 1,
              total: prev?.total ?? 1,
              indeterminate: false,
            }));
          } else if (line.type === 'error') {
            errorMsg = line.error ?? 'Erro desconhecido';
          }
        }
      }
    } catch (err: any) {
      errorMsg = err?.message ?? 'Erro de rede';
    }

    if (errorMsg) {
      alert(`Erro em ${label}: ${errorMsg}`);
      setSyncProgress(null);
      return;
    }

    if (success) {
      setTimeout(() => window.location.reload(), 400);
    } else {
      setSyncProgress(null);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await runStreamedSync('/api/accounts/sync', 'Sincronizar Meta');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSyncStatus = async () => {
    setIsSyncingStatus(true);
    try {
      await runStreamedSync('/api/status-contas/sync', 'Atualizar Status');
    } finally {
      setIsSyncingStatus(false);
    }
  };

  const toggleGroup = (name: string) =>
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });

  const toggleSelectAccount = (accountId: string) =>
    setSelectedAccounts(prev => {
      const next = new Set(prev);
      next.has(accountId) ? next.delete(accountId) : next.add(accountId);
      return next;
    });

  const toggleSelectGroup = (groupAccounts: Account[]) => {
    const ids = groupAccounts.map(a => a.account_id);
    const allSelected = ids.every(id => selectedAccounts.has(id));
    setSelectedAccounts(prev => {
      const next = new Set(prev);
      ids.forEach(id => allSelected ? next.delete(id) : next.add(id));
      return next;
    });
  };

  const formatCurrency = (v: number, currency = 'BRL') => {
    const locale = currency === 'BRL' ? 'pt-BR' : 'en-US';
    return v.toLocaleString(locale, { style: 'currency', currency });
  };

  const zeroCurrencyLabel = (currency = 'BRL') => {
    const locale = currency === 'BRL' ? 'pt-BR' : 'en-US';
    return (0).toLocaleString(locale, { style: 'currency', currency });
  };

  const allExpanded = expandedGroups.size > 0;

  return (
    <div className="flex flex-col gap-5">

      {/* Action Bar */}
      <div className="flex justify-end items-center gap-3">
        <div className="mr-auto">
          <SyncFreshness lastSync={lastSync} />
        </div>
        {syncProgress && (
          <div className="flex-1 max-w-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm px-4 py-2">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-xs font-bold text-gray-700 dark:text-gray-300 truncate">{syncProgress.label}</span>
              <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 tabular-nums whitespace-nowrap">
                {syncProgress.total > 0
                  ? `${syncProgress.current}/${syncProgress.total} · ${Math.min(100, Math.round((syncProgress.current / syncProgress.total) * 100))}%`
                  : 'em andamento…'}
              </span>
            </div>
            <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
              {syncProgress.indeterminate || syncProgress.total === 0 ? (
                <div className="h-full w-1/3 bg-indigo-500 rounded-full animate-[sync-indeterminate_1.2s_ease-in-out_infinite]" />
              ) : (
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.round((syncProgress.current / syncProgress.total) * 100))}%` }}
                />
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400 truncate">{syncProgress.message}</p>
          </div>
        )}
        <button
          onClick={handleSyncStatus}
          disabled={isSyncingStatus}
          className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors shadow-sm disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isSyncingStatus ? 'animate-spin' : ''}`} />
          Atualizar Status
        </button>
        <button
          onClick={handleSync}
          disabled={isSyncing}
          className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors shadow-sm disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
          Sincronizar Meta
        </button>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-xl text-sm font-medium text-white transition-colors shadow-sm"
        >
          <PlusCircle className="w-4 h-4" />
          + Cadastrar Nova Conta
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-5 gap-4">
        {[
          { label: 'TOTAL CONTAS', value: String(kpis.total),       cls: 'text-gray-800 dark:text-gray-100' },
          { label: 'ATIVAS',       value: String(kpis.ativas),      cls: 'text-green-600' },
          { label: 'DESATIVADAS',  value: String(kpis.desativadas), cls: 'text-red-500' },
          { label: 'EM ANÁLISE',   value: String(kpis.emAnalise),   cls: 'text-amber-500' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-5">
            <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-widest mb-2">{kpi.label}</p>
            <p className={`text-2xl font-bold ${kpi.cls}`}>{kpi.value}</p>
          </div>
        ))}

        {/* Gasto Total — separado por moeda */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-5">
          <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-widest mb-2">GASTO TOTAL</p>
          {Object.entries(kpis.gastoTotalByCurrency).length === 0 ? (
            <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">R$ 0,00</p>
          ) : (
            <div className="flex flex-col gap-1">
              {Object.entries(kpis.gastoTotalByCurrency).map(([cur, total]) => (
                <p key={cur} className="text-xl font-bold text-gray-800 dark:text-gray-100 leading-tight">
                  {formatCurrency(total, cur)}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm px-5 py-4 flex flex-wrap gap-5 items-end">
        {/* Gestor */}
        <div className="flex flex-col gap-1 min-w-[150px]">
          <label className="text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider">Gestor</label>
          <select value={filterGestor} onChange={e => setFilterGestor(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-xs w-full outline-none focus:border-indigo-400 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100">
            <option value="">Todos</option>
            {GESTORES.map(g => <option key={g} value={g}>{g}</option>)}
            <option value="__NONE__">Sem gestor</option>
          </select>
        </div>

        {/* Oferta */}
        <div className="flex flex-col gap-1 min-w-[150px]">
          <label className="text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider">Oferta</label>
          <select value={filterOferta} onChange={e => setFilterOferta(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-xs w-full outline-none focus:border-indigo-400 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100">
            <option value="">Todas</option>
            {ofertasOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            <option value="__NONE__">Sem oferta</option>
          </select>
        </div>

        {/* Etapa */}
        <div className="flex flex-col gap-1 min-w-[160px]">
          <label className="text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider">Etapa</label>
          <select value={filterEtapa} onChange={e => setFilterEtapa(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-xs w-full outline-none focus:border-indigo-400 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100">
            <option value="">Todas</option>
            {ETAPAS.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>

        {/* Moeda */}
        <div className="flex flex-col gap-1 min-w-[120px]">
          <label className="text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider">Moeda</label>
          <select value={filterMoeda} onChange={e => setFilterMoeda(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-xs w-full outline-none focus:border-indigo-400 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100">
            <option value="">Todas</option>
            {uniqueMoedas.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        {/* Status */}
        <div className="flex flex-col gap-1 min-w-[140px]">
          <label className="text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider">Status</label>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-xs w-full outline-none focus:border-indigo-400 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100">
            <option value="">Todos</option>
            <option value="ACTIVE">Ativo</option>
            <option value="INACTIVE">Desativado / Restrito</option>
          </select>
        </div>

        {/* Cartão */}
        <div className="flex flex-col gap-1 min-w-[140px]">
          <label className="text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider">Cartão</label>
          <select value={filterCartao} onChange={e => setFilterCartao(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-xs w-full outline-none focus:border-indigo-400 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100">
            <option value="">Todos</option>
            <option value="COM_CARTAO">Com cartão</option>
            <option value="SEM_CARTAO">Sem cartão</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">

        {/* Toolbar */}
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nome, ID, cartão, gestor..."
              className="pl-9 pr-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-xs w-72 outline-none focus:border-indigo-400 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
            />
          </div>

          <div className="flex items-center gap-2 ml-auto flex-wrap">
            {selectedAccounts.size > 0 && (
              <div className="flex items-center gap-2 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 rounded-lg px-3 py-1.5">
                <span className="text-xs text-indigo-700 dark:text-indigo-400 font-semibold">{selectedAccounts.size} selecionada{selectedAccounts.size !== 1 ? 's' : ''}</span>
                <select value={batchEtapa} onChange={e => setBatchEtapa(e.target.value)}
                  className="text-xs border border-indigo-200 dark:border-indigo-800 rounded px-2 py-1 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 outline-none">
                  <option value="">Selecionar etapa...</option>
                  {ETAPAS.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
                <button onClick={handleBatchUpdate} disabled={!batchEtapa || isUpdatingBatch}
                  className="text-xs bg-indigo-600 text-white px-3 py-1 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors font-semibold">
                  Aplicar
                </button>
                <button onClick={() => setSelectedAccounts(new Set())} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <button
              onClick={() => allExpanded ? setExpandedGroups(new Set()) : setExpandedGroups(new Set(accounts.map(a => a.bm_name)))}
              className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <ChevronDown className="w-3.5 h-3.5" />
              {allExpanded ? 'Colapsar Tudo' : 'Expandir Tudo'}
            </button>
          </div>
        </div>

        {/* Table Header */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[900px]">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider">
                <th className="px-3 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={filteredAccounts.length > 0 && filteredAccounts.every(a => selectedAccounts.has(a.account_id))}
                    onChange={e => {
                      if (e.target.checked) setSelectedAccounts(new Set(filteredAccounts.map(a => a.account_id)));
                      else setSelectedAccounts(new Set());
                    }}
                    className="rounded border-gray-300 dark:border-gray-700 text-indigo-600 accent-indigo-600"
                  />
                </th>
                <th className="px-4 py-3">Conta</th>
                <th className="px-4 py-3">ID Meta</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Gasto Total</th>
                <th className="px-4 py-3 text-right">Limite Diário</th>
                <th className="px-4 py-3">Moeda</th>
                <th className="px-4 py-3">Etapa</th>
                <th className="px-4 py-3">Oferta</th>
                <th className="px-4 py-3">Cartão</th>
                <th className="px-4 py-3">Gestor</th>
                <th className="px-4 py-3">Fuso Horário</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {groups.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-6 py-12 text-center text-sm text-gray-400 dark:text-gray-500">
                    Nenhuma conta encontrada.
                  </td>
                </tr>
              )}

              {groups.map(group => {
                const isExpanded = expandedGroups.has(group.name);
                const groupGestor = group.accounts.find(a => a.gestor)?.gestor ?? null;
                const groupPerfil = group.accounts.find(a => a.perfil)?.perfil ?? null;
                const allGroupSelected = group.accounts.every(a => selectedAccounts.has(a.account_id));

                return (
                  <React.Fragment key={group.name}>
                    {/* Group Header Row */}
                    <tr
                      className="bg-indigo-50/60 dark:bg-indigo-950/40 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 cursor-pointer select-none border-t border-indigo-100 dark:border-indigo-800"
                      onClick={() => toggleGroup(group.name)}
                    >
                      <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={allGroupSelected && group.accounts.length > 0}
                          onChange={() => toggleSelectGroup(group.accounts)}
                          className="rounded border-gray-300 dark:border-gray-700 text-indigo-600 accent-indigo-600"
                        />
                      </td>
                      <td colSpan={10} className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="text-indigo-500">
                            {isExpanded
                              ? <ChevronDown className="w-4 h-4 inline" />
                              : <ChevronRight className="w-4 h-4 inline" />}
                          </span>
                          <span className="font-bold text-indigo-700 dark:text-indigo-400 text-sm uppercase tracking-wide">{group.name}</span>
                          {(groupPerfil || groupGestor) && (
                            <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                              {groupPerfil ? `Perfil: ${groupPerfil}` : ''}
                              {groupPerfil && groupGestor ? ' — ' : ''}
                              {groupGestor ?? ''}
                            </span>
                          )}
                          <span className="ml-1 text-xs text-gray-400 dark:text-gray-500 font-medium">
                            ({group.accounts.length} {group.accounts.length === 1 ? 'conta' : 'contas'})
                          </span>
                        </div>
                      </td>
                    </tr>

                    {/* Account Rows */}
                    {isExpanded && group.accounts.map(acc => {
                      const isSelected = selectedAccounts.has(acc.account_id);

                      return (
                        <tr
                          key={acc.account_id}
                          className={`text-xs transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 ${isSelected ? 'bg-indigo-50/30 dark:bg-indigo-950/20' : ''}`}
                        >
                          <td className="px-3 py-3">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectAccount(acc.account_id)}
                              className="rounded border-gray-300 dark:border-gray-700 text-indigo-600 accent-indigo-600"
                            />
                          </td>
                          <td className="px-4 py-3 font-semibold text-gray-800 dark:text-gray-100 whitespace-nowrap">
                            {acc.account_name}
                          </td>
                          <td className="px-4 py-3 font-mono text-gray-400 dark:text-gray-500 text-[11px]">
                            {acc.account_id}
                          </td>
                          <td className="px-4 py-3">
                            <AccountStatusBadge status={acc.account_status} />
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-gray-700 dark:text-gray-300">
                            {Number(acc.gasto_total) > 0
                              ? formatCurrency(Number(acc.gasto_total), acc.moeda)
                              : <span className="text-gray-300 dark:text-gray-600">{zeroCurrencyLabel(acc.moeda)}</span>}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-gray-500 dark:text-gray-400">
                            {Number(acc.limite) > 0
                              ? formatCurrency(Number(acc.limite), acc.moeda)
                              : <span className="text-gray-300 dark:text-gray-600">{zeroCurrencyLabel(acc.moeda)}</span>}
                          </td>
                          <td className="px-4 py-3 text-gray-600 dark:text-gray-300 font-medium">{acc.moeda}</td>
                          <td className="px-4 py-3">
                            <EtapaDropdown
                              accountId={acc.account_id}
                              currentEtapa={acc.etapa}
                              onUpdate={updateEtapa}
                            />
                          </td>
                          <td className="px-4 py-3">
                            {acc.oferta_ids.length === 0 ? (
                              <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {acc.oferta_ids.map(id => {
                                  const label = ofertasOptions.find(o => o.value === String(id))?.label ?? String(id);
                                  return (
                                    <span key={id} className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-800">
                                      {label}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-400 dark:text-gray-500">{acc.cartao ?? <span className="text-gray-200 dark:text-gray-700">—</span>}</td>
                          <td className="px-4 py-3">
                            <FieldDropdown
                              accountId={acc.account_id}
                              field="gestor"
                              currentValue={acc.gestor}
                              options={GESTORES.map(g => ({ value: g, label: g }))}
                              placeholder="—"
                              onUpdate={updateField}
                            />
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {acc.timezone ? (
                              <div className="flex flex-col gap-0.5">
                                <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400">{acc.timezone}</span>
                                <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500">{getGmtOffset(acc.timezone)}</span>
                              </div>
                            ) : (
                              <span className="text-gray-200 dark:text-gray-700">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Account Modal */}
      {showModal && (
        <NewAccountModal
          onClose={() => setShowModal(false)}
          onSuccess={() => window.location.reload()}
        />
      )}
    </div>
  );
}
