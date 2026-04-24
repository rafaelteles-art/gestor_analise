'use client'

import { useState } from 'react';
import { toggleAccountSelection, toggleAllAccountsSelection, toggleBmSelection } from '../actions';
import { handleStaleServerAction } from '@/lib/stale-action';
import { RefreshCw, CheckCircle2, CheckSquare, Square, ChevronDown } from 'lucide-react';

interface Account {
  id: string;
  account_id: string;
  account_name: string;
  bm_id: string;
  bm_name: string;
  is_selected: boolean;
}

interface BmGroup {
  bm_id: string;
  bm_name: string;
  accounts: Account[];
}

function groupByBm(accounts: Account[]): BmGroup[] {
  const map = new Map<string, BmGroup>();
  for (const acc of accounts) {
    if (!map.has(acc.bm_id)) {
      map.set(acc.bm_id, { bm_id: acc.bm_id, bm_name: acc.bm_name, accounts: [] });
    }
    map.get(acc.bm_id)!.accounts.push(acc);
  }
  // Ordena grupos por nome de BM; contas dentro de cada grupo por nome
  return Array.from(map.values())
    .sort((a, b) => a.bm_name.localeCompare(b.bm_name))
    .map(g => ({ ...g, accounts: g.accounts.sort((a, b) => a.account_name.localeCompare(b.account_name)) }));
}

export default function AccountList({ initialAccounts }: { initialAccounts: Account[] }) {
  const [accounts, setAccounts] = useState<Account[]>(initialAccounts);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string>('');
  const [syncPct, setSyncPct] = useState<number>(0);
  // Grupos colapsados: começa com todos abertos
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = groupByBm(accounts);

  // ── Toggles individuais ───────────────────────────────────────────────────
  const handleToggle = async (accountId: string, currentStatus: boolean) => {
    const newStatus = !currentStatus;
    setAccounts(prev => prev.map(a => a.account_id === accountId ? { ...a, is_selected: newStatus } : a));
    try {
      await toggleAccountSelection(accountId, newStatus);
    } catch (err) {
      if (handleStaleServerAction(err)) return;
      setAccounts(prev => prev.map(a => a.account_id === accountId ? { ...a, is_selected: currentStatus } : a));
      alert('Falha ao atualizar conta.');
    }
  };

  // ── Toggle de BM inteira ──────────────────────────────────────────────────
  const handleToggleBm = async (bmId: string, newStatus: boolean) => {
    const prev = [...accounts];
    setAccounts(prevAccs => prevAccs.map(a => a.bm_id === bmId ? { ...a, is_selected: newStatus } : a));
    try {
      await toggleBmSelection(bmId, newStatus);
    } catch (err) {
      if (handleStaleServerAction(err)) return;
      setAccounts(prev);
      alert('Falha ao atualizar BM.');
    }
  };

  // ── Toggle global ─────────────────────────────────────────────────────────
  const handleToggleAll = async (newStatus: boolean) => {
    const prev = [...accounts];
    setAccounts(prevAccs => prevAccs.map(a => ({ ...a, is_selected: newStatus })));
    try {
      await toggleAllAccountsSelection(newStatus);
    } catch (err) {
      if (handleStaleServerAction(err)) return;
      setAccounts(prev);
      alert('Falha ao atualizar todas as contas.');
    }
  };

  // ── Scan contas novas ─────────────────────────────────────────────────────
  // A rota /api/accounts/sync responde em NDJSON (um JSON por linha).
  // Drenamos o stream, atualizamos status/progresso e reload no final.
  //
  // Progresso (apenas Meta — RT é sincronizado em outro painel):
  //   start → 3%
  //   "BM X/Y:" parseado das mensagens → 5 + (X/Y)*94  (range 5-99%)
  //   done  → 100%
  const syncAccounts = async () => {
    setIsSyncing(true);
    setSyncStatus('Iniciando…');
    setSyncPct(1);
    try {
      const res = await fetch('/api/accounts/sync');
      if (!res.ok || !res.body) {
        alert('Erro ao sincronizar: HTTP ' + res.status);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let lastEvent: any = null;

      const applyEvent = (ev: any) => {
        if (!ev || typeof ev !== 'object') return;
        if (ev.message) setSyncStatus(String(ev.message));

        if (ev.type === 'start') {
          setSyncPct(3);
          return;
        }
        if (ev.type === 'done') {
          setSyncPct(100);
          return;
        }
        if (ev.type === 'error') return;

        if (ev.phase === 'meta') {
          // Tenta extrair "BM X/Y:" da mensagem para progresso fino.
          const m = typeof ev.message === 'string' ? ev.message.match(/BM\s+(\d+)\/(\d+)/) : null;
          if (m) {
            const idx = Number(m[1]);
            const total = Number(m[2]);
            if (total > 0) {
              const pct = 5 + Math.round((idx / total) * 94); // 5-99%
              setSyncPct(prev => Math.max(prev, pct));
              return;
            }
          }
          setSyncPct(prev => Math.max(prev, 5));
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          if (!part.trim()) continue;
          try {
            const ev = JSON.parse(part);
            lastEvent = ev;
            applyEvent(ev);
          } catch { /* ignora linha malformada */ }
        }
      }
      if (buffer.trim()) {
        try {
          const ev = JSON.parse(buffer);
          lastEvent = ev;
          applyEvent(ev);
        } catch { /* ignora resto malformado */ }
      }

      if (lastEvent?.type === 'done' && lastEvent?.success) {
        setSyncStatus('Concluído — recarregando…');
        window.location.reload();
      } else if (lastEvent?.type === 'error') {
        alert('Erro ao sincronizar: ' + (lastEvent.error ?? 'desconhecido'));
      } else {
        alert('Erro ao sincronizar: resposta inesperada do servidor.');
      }
    } catch (e: any) {
      alert('Erro de rede: ' + (e?.message ?? String(e)));
    } finally {
      setIsSyncing(false);
      setSyncPct(0);
      setSyncStatus('');
    }
  };

  const toggleCollapse = (bmId: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(bmId) ? next.delete(bmId) : next.add(bmId);
      return next;
    });
  };

  const selectedCount = accounts.filter(a => a.is_selected).length;

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-end mb-5">
        <div>
          <h2 className="text-sm font-bold text-gray-800">Contas de Anúncio</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {selectedCount} de {accounts.length} conta(s) ativa(s)
          </p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => handleToggleAll(true)}
              className="flex items-center gap-1.5 text-xs text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors border border-transparent"
            >
              <CheckSquare className="w-3.5 h-3.5" /> Ativar todas
            </button>
            <button
              onClick={() => handleToggleAll(false)}
              className="flex items-center gap-1.5 text-xs text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Square className="w-3.5 h-3.5" /> Desativar todas
            </button>
          </div>
        </div>

        <button
          onClick={syncAccounts}
          disabled={isSyncing}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-xl text-xs font-semibold text-white transition-all disabled:opacity-50 shadow-sm"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
          {isSyncing ? 'Escaneando...' : 'Escanear contas'}
        </button>
      </div>

      {/* Barra de progresso do scan */}
      {isSyncing && (
        <div className="mb-5 bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm">
          <div className="flex justify-between items-center text-[11px] text-gray-500 mb-1.5">
            <span className="truncate pr-3">{syncStatus || 'Processando…'}</span>
            <span className="font-mono shrink-0">{syncPct}%</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${syncPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Grouped list */}
      {accounts.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center text-gray-400 text-sm shadow-sm">
          Nenhuma conta mapeada. Clique em "Escanear contas" para importar do Facebook.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map(group => {
            const isOpen = !collapsed.has(group.bm_id);
            const bmSelected = group.accounts.filter(a => a.is_selected).length;
            const bmTotal    = group.accounts.length;
            const allOn      = bmSelected === bmTotal;
            const allOff     = bmSelected === 0;

            return (
              <div key={group.bm_id} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">

                {/* BM header row */}
                <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b border-gray-100">
                  <button
                    onClick={() => toggleCollapse(group.bm_id)}
                    className="flex items-center gap-2 text-left flex-1 min-w-0"
                  >
                    <ChevronDown
                      className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${isOpen ? '' : '-rotate-90'}`}
                    />
                    <div className="min-w-0">
                      <span className="text-sm font-bold text-gray-800 truncate block">{group.bm_name}</span>
                      <span className="text-[10px] text-gray-400 font-mono">{group.bm_id}</span>
                    </div>
                  </button>

                  <div className="flex items-center gap-3 shrink-0 ml-4">
                    <span className="text-xs text-gray-500">
                      {bmSelected}/{bmTotal} ativa{bmSelected !== 1 ? 's' : ''}
                    </span>

                    {/* Toggle BM inteira */}
                    <button
                      onClick={() => handleToggleBm(group.bm_id, !allOn)}
                      title={allOn ? 'Desativar BM inteira' : 'Ativar BM inteira'}
                      className={`flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-md transition-colors border ${
                        allOn
                          ? 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                          : allOff
                          ? 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                          : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                      }`}
                    >
                      {allOn
                        ? <><Square className="w-3 h-3" /> Desativar BM</>
                        : <><CheckSquare className="w-3 h-3" /> Ativar BM</>
                      }
                    </button>
                  </div>
                </div>

                {/* Account rows */}
                {isOpen && (
                  <div className="divide-y divide-gray-50">
                    {group.accounts.map(acc => (
                      <div key={acc.account_id} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{acc.account_name}</p>
                          <p className="text-[11px] text-gray-400 font-mono mt-0.5">{acc.account_id}</p>
                        </div>

                        <div className="flex items-center gap-2.5 shrink-0 ml-4">
                          {acc.is_selected && (
                            <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> Ativa
                            </span>
                          )}
                          <button
                            onClick={() => handleToggle(acc.account_id, acc.is_selected)}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                              acc.is_selected ? 'bg-indigo-600' : 'bg-gray-200'
                            }`}
                          >
                            <span
                              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform ${
                                acc.is_selected ? 'translate-x-4' : 'translate-x-0.5'
                              }`}
                            />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
