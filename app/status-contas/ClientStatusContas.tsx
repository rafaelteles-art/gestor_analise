'use client';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { RefreshCw, PlusCircle, Search, ChevronDown, ChevronRight, X } from 'lucide-react';

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
  oferta: string[];
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
  'ACTIVE':                   { label: 'Ativo',           cls: 'bg-green-50 text-green-700' },
  'DISABLED':                 { label: 'Desabilitado',    cls: 'bg-red-50 text-red-600' },
  'UNSETTLED':                { label: 'Inadimplente',    cls: 'bg-orange-50 text-orange-700' },
  'PENDING_REVIEW':           { label: 'Em Revisão',      cls: 'bg-yellow-50 text-yellow-700' },
  'PENDING_CLOSURE':          { label: 'Encerrando',      cls: 'bg-orange-50 text-orange-600' },
  'IN_GRACE_PERIOD':          { label: 'Carência',        cls: 'bg-amber-50 text-amber-700' },
  'TEMPORARILY_UNAVAILABLE':  { label: 'Indisponível',    cls: 'bg-gray-100 text-gray-500' },
  'CLOSED':                   { label: 'Encerrada',       cls: 'bg-gray-100 text-gray-400' },
  'UNKNOWN':                  { label: 'Desconhecido',    cls: 'bg-gray-100 text-gray-400' },
};

function AccountStatusBadge({ status }: { status: string }) {
  const cfg = ACCOUNT_STATUS_LABEL[status] ?? { label: status, cls: 'bg-gray-100 text-gray-500' };
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
  'Não Utilizada':    { bg: 'bg-gray-100',    text: 'text-gray-600',   border: 'border-gray-200' },
  'Adicionar Cartão': { bg: 'bg-purple-50',   text: 'text-purple-700', border: 'border-purple-200' },
  'Subir Aquecimento':{ bg: 'bg-amber-50',    text: 'text-amber-700',  border: 'border-amber-200' },
  'Aquecimento':      { bg: 'bg-orange-50',   text: 'text-orange-700', border: 'border-orange-200' },
  'Disponível':       { bg: 'bg-green-50',    text: 'text-green-700',  border: 'border-green-200' },
  'Suspenso':         { bg: 'bg-red-50',      text: 'text-red-700',    border: 'border-red-200' },
  'Em Análise':       { bg: 'bg-yellow-50',   text: 'text-yellow-700', border: 'border-yellow-200' },
  'Em Uso':           { bg: 'bg-blue-50',     text: 'text-blue-700',   border: 'border-blue-200' },
  'Análise Rejeitada':{ bg: 'bg-rose-50',     text: 'text-rose-700',   border: 'border-rose-200' },
};

function getEtapaStyle(etapa: string) {
  return ETAPA_STYLE[etapa] ?? { bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-200' };
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
        <div className="absolute z-50 top-full mt-1 left-0 bg-white border border-gray-200 rounded-xl shadow-xl py-1 min-w-[185px]">
          {ETAPAS.map(etapa => {
            const es = getEtapaStyle(etapa);
            const active = etapa === currentEtapa;
            return (
              <button
                key={etapa}
                onClick={() => { onUpdate(accountId, etapa); setIsOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-gray-50 transition-colors ${active ? 'font-semibold' : ''}`}
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
  options: readonly string[];
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

  function toggle(opt: string) {
    const next = currentValue.includes(opt)
      ? currentValue.filter(v => v !== opt)
      : [...currentValue, opt];
    onUpdate(accountId, field, next);
  }

  const label = currentValue.length === 0
    ? <span className="text-gray-300">{placeholder}</span>
    : <span className="text-gray-700">{currentValue.join(', ')}</span>;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setIsOpen(o => !o)}
        className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border whitespace-nowrap transition-opacity hover:opacity-80 bg-gray-50 text-gray-600 border-gray-200"
      >
        {label}
        <ChevronDown className="w-3 h-3 opacity-60 shrink-0" />
      </button>

      {isOpen && (
        <div className="absolute z-50 top-full mt-1 left-0 bg-white border border-gray-200 rounded-xl shadow-xl py-1 min-w-[160px]">
          {options.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-400 italic">Nenhuma opção disponível</p>
          ) : (
            options.map(opt => {
              const active = currentValue.includes(opt);
              return (
                <button
                  key={opt}
                  onClick={() => toggle(opt)}
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-gray-50 transition-colors ${active ? 'font-semibold' : ''}`}
                >
                  <span className={`w-3.5 h-3.5 flex items-center justify-center rounded border shrink-0 transition-colors ${active ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-300'}`}>
                    {active && '✓'}
                  </span>
                  {opt}
                </button>
              );
            })
          )}
          {currentValue.length > 0 && (
            <>
              <div className="border-t border-gray-100 my-1" />
              <button
                onClick={() => { onUpdate(accountId, field, []); setIsOpen(false); }}
                className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
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
      <label className="text-xs font-semibold text-gray-500">{label}</label>
      <input
        type={type}
        value={form[key] as string}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-indigo-400 bg-gray-50"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-800">Cadastrar Nova Conta</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
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
              <label className="text-xs font-semibold text-gray-500">Etapa</label>
              <select
                value={form.etapa}
                onChange={e => setForm(f => ({ ...f, etapa: e.target.value as Etapa }))}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-indigo-400 bg-gray-50"
              >
                {ETAPAS.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-500">Moeda</label>
              <select
                value={form.moeda}
                onChange={e => setForm(f => ({ ...f, moeda: e.target.value }))}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-indigo-400 bg-gray-50"
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
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
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

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ClientStatusContas({
  initialAccounts,
  ofertasOptions = [],
}: {
  initialAccounts: Account[];
  ofertasOptions?: string[];
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
      if (filterOferta === '__NONE__' && acc.oferta.length > 0) return false;
      if (filterOferta && filterOferta !== '__NONE__' && !acc.oferta.includes(filterOferta)) return false;
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

  // ── Update Field (gestor, oferta — arrays) ──
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
        {syncProgress && (
          <div className="flex-1 max-w-md bg-white border border-gray-200 rounded-xl shadow-sm px-4 py-2">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-xs font-bold text-gray-700 truncate">{syncProgress.label}</span>
              <span className="text-[10px] font-medium text-gray-500 tabular-nums whitespace-nowrap">
                {syncProgress.total > 0
                  ? `${syncProgress.current}/${syncProgress.total} · ${Math.min(100, Math.round((syncProgress.current / syncProgress.total) * 100))}%`
                  : 'em andamento…'}
              </span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              {syncProgress.indeterminate || syncProgress.total === 0 ? (
                <div className="h-full w-1/3 bg-indigo-500 rounded-full animate-[sync-indeterminate_1.2s_ease-in-out_infinite]" />
              ) : (
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.round((syncProgress.current / syncProgress.total) * 100))}%` }}
                />
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-gray-500 truncate">{syncProgress.message}</p>
          </div>
        )}
        <button
          onClick={handleSyncStatus}
          disabled={isSyncingStatus}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isSyncingStatus ? 'animate-spin' : ''}`} />
          Atualizar Status
        </button>
        <button
          onClick={handleSync}
          disabled={isSyncing}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm disabled:opacity-50"
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
          { label: 'TOTAL CONTAS', value: String(kpis.total),       cls: 'text-gray-800' },
          { label: 'ATIVAS',       value: String(kpis.ativas),      cls: 'text-green-600' },
          { label: 'DESATIVADAS',  value: String(kpis.desativadas), cls: 'text-red-500' },
          { label: 'EM ANÁLISE',   value: String(kpis.emAnalise),   cls: 'text-amber-500' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-2">{kpi.label}</p>
            <p className={`text-2xl font-bold ${kpi.cls}`}>{kpi.value}</p>
          </div>
        ))}

        {/* Gasto Total — separado por moeda */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-2">GASTO TOTAL</p>
          {Object.entries(kpis.gastoTotalByCurrency).length === 0 ? (
            <p className="text-2xl font-bold text-gray-800">R$ 0,00</p>
          ) : (
            <div className="flex flex-col gap-1">
              {Object.entries(kpis.gastoTotalByCurrency).map(([cur, total]) => (
                <p key={cur} className="text-xl font-bold text-gray-800 leading-tight">
                  {formatCurrency(total, cur)}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-4 flex flex-wrap gap-5 items-end">
        {/* Gestor */}
        <div className="flex flex-col gap-1 min-w-[150px]">
          <label className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Gestor</label>
          <select value={filterGestor} onChange={e => setFilterGestor(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs w-full outline-none focus:border-indigo-400 bg-gray-50">
            <option value="">Todos</option>
            {GESTORES.map(g => <option key={g} value={g}>{g}</option>)}
            <option value="__NONE__">Sem gestor</option>
          </select>
        </div>

        {/* Oferta */}
        <div className="flex flex-col gap-1 min-w-[150px]">
          <label className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Oferta</label>
          <select value={filterOferta} onChange={e => setFilterOferta(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs w-full outline-none focus:border-indigo-400 bg-gray-50">
            <option value="">Todas</option>
            {ofertasOptions.map(o => <option key={o} value={o}>{o}</option>)}
            <option value="__NONE__">Sem oferta</option>
          </select>
        </div>

        {/* Etapa */}
        <div className="flex flex-col gap-1 min-w-[160px]">
          <label className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Etapa</label>
          <select value={filterEtapa} onChange={e => setFilterEtapa(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs w-full outline-none focus:border-indigo-400 bg-gray-50">
            <option value="">Todas</option>
            {ETAPAS.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>

        {/* Moeda */}
        <div className="flex flex-col gap-1 min-w-[120px]">
          <label className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Moeda</label>
          <select value={filterMoeda} onChange={e => setFilterMoeda(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs w-full outline-none focus:border-indigo-400 bg-gray-50">
            <option value="">Todas</option>
            {uniqueMoedas.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        {/* Status */}
        <div className="flex flex-col gap-1 min-w-[140px]">
          <label className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Status</label>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs w-full outline-none focus:border-indigo-400 bg-gray-50">
            <option value="">Todos</option>
            <option value="ACTIVE">Ativo</option>
            <option value="INACTIVE">Desativado / Restrito</option>
          </select>
        </div>

        {/* Cartão */}
        <div className="flex flex-col gap-1 min-w-[140px]">
          <label className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Cartão</label>
          <select value={filterCartao} onChange={e => setFilterCartao(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs w-full outline-none focus:border-indigo-400 bg-gray-50">
            <option value="">Todos</option>
            <option value="COM_CARTAO">Com cartão</option>
            <option value="SEM_CARTAO">Sem cartão</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">

        {/* Toolbar */}
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nome, ID, cartão, gestor..."
              className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-xs w-72 outline-none focus:border-indigo-400 bg-gray-50"
            />
          </div>

          <div className="flex items-center gap-2 ml-auto flex-wrap">
            {selectedAccounts.size > 0 && (
              <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-1.5">
                <span className="text-xs text-indigo-700 font-semibold">{selectedAccounts.size} selecionada{selectedAccounts.size !== 1 ? 's' : ''}</span>
                <select value={batchEtapa} onChange={e => setBatchEtapa(e.target.value)}
                  className="text-xs border border-indigo-200 rounded px-2 py-1 bg-white outline-none">
                  <option value="">Selecionar etapa...</option>
                  {ETAPAS.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
                <button onClick={handleBatchUpdate} disabled={!batchEtapa || isUpdatingBatch}
                  className="text-xs bg-indigo-600 text-white px-3 py-1 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors font-semibold">
                  Aplicar
                </button>
                <button onClick={() => setSelectedAccounts(new Set())} className="text-gray-400 hover:text-gray-600 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <button
              onClick={() => allExpanded ? setExpandedGroups(new Set()) : setExpandedGroups(new Set(accounts.map(a => a.bm_name)))}
              className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
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
              <tr className="bg-gray-50 border-b border-gray-200 text-[10px] text-gray-500 font-bold uppercase tracking-wider">
                <th className="px-3 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={filteredAccounts.length > 0 && filteredAccounts.every(a => selectedAccounts.has(a.account_id))}
                    onChange={e => {
                      if (e.target.checked) setSelectedAccounts(new Set(filteredAccounts.map(a => a.account_id)));
                      else setSelectedAccounts(new Set());
                    }}
                    className="rounded border-gray-300 text-indigo-600 accent-indigo-600"
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
            <tbody className="divide-y divide-gray-100">
              {groups.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-6 py-12 text-center text-sm text-gray-400">
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
                      className="bg-indigo-50/60 hover:bg-indigo-50 cursor-pointer select-none border-t border-indigo-100"
                      onClick={() => toggleGroup(group.name)}
                    >
                      <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={allGroupSelected && group.accounts.length > 0}
                          onChange={() => toggleSelectGroup(group.accounts)}
                          className="rounded border-gray-300 text-indigo-600 accent-indigo-600"
                        />
                      </td>
                      <td colSpan={10} className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="text-indigo-500">
                            {isExpanded
                              ? <ChevronDown className="w-4 h-4 inline" />
                              : <ChevronRight className="w-4 h-4 inline" />}
                          </span>
                          <span className="font-bold text-indigo-700 text-sm uppercase tracking-wide">{group.name}</span>
                          {(groupPerfil || groupGestor) && (
                            <span className="text-xs text-gray-500 font-medium">
                              {groupPerfil ? `Perfil: ${groupPerfil}` : ''}
                              {groupPerfil && groupGestor ? ' — ' : ''}
                              {groupGestor ?? ''}
                            </span>
                          )}
                          <span className="ml-1 text-xs text-gray-400 font-medium">
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
                          className={`text-xs transition-colors hover:bg-gray-50 ${isSelected ? 'bg-indigo-50/30' : ''}`}
                        >
                          <td className="px-3 py-3">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectAccount(acc.account_id)}
                              className="rounded border-gray-300 text-indigo-600 accent-indigo-600"
                            />
                          </td>
                          <td className="px-4 py-3 font-semibold text-gray-800 whitespace-nowrap">
                            {acc.account_name}
                          </td>
                          <td className="px-4 py-3 font-mono text-gray-400 text-[11px]">
                            {acc.account_id}
                          </td>
                          <td className="px-4 py-3">
                            <AccountStatusBadge status={acc.account_status} />
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-gray-700">
                            {Number(acc.gasto_total) > 0
                              ? formatCurrency(Number(acc.gasto_total), acc.moeda)
                              : <span className="text-gray-300">{zeroCurrencyLabel(acc.moeda)}</span>}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-gray-500">
                            {Number(acc.limite) > 0
                              ? formatCurrency(Number(acc.limite), acc.moeda)
                              : <span className="text-gray-300">{zeroCurrencyLabel(acc.moeda)}</span>}
                          </td>
                          <td className="px-4 py-3 text-gray-600 font-medium">{acc.moeda}</td>
                          <td className="px-4 py-3">
                            <EtapaDropdown
                              accountId={acc.account_id}
                              currentEtapa={acc.etapa}
                              onUpdate={updateEtapa}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <FieldDropdown
                              accountId={acc.account_id}
                              field="oferta"
                              currentValue={acc.oferta}
                              options={ofertasOptions}
                              placeholder="—"
                              onUpdate={updateField}
                            />
                          </td>
                          <td className="px-4 py-3 text-gray-400">{acc.cartao ?? <span className="text-gray-200">—</span>}</td>
                          <td className="px-4 py-3">
                            <FieldDropdown
                              accountId={acc.account_id}
                              field="gestor"
                              currentValue={acc.gestor}
                              options={GESTORES}
                              placeholder="—"
                              onUpdate={updateField}
                            />
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {acc.timezone ? (
                              <div className="flex flex-col gap-0.5">
                                <span className="font-mono text-[11px] text-gray-500">{acc.timezone}</span>
                                <span className="text-[10px] font-semibold text-gray-400">{getGmtOffset(acc.timezone)}</span>
                              </div>
                            ) : (
                              <span className="text-gray-200">—</span>
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
