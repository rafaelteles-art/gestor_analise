'use client';

import { useMemo, useState } from 'react';
import { toggleAccountBlacklist, toggleBmBlacklist } from '../actions';
import { handleStaleServerAction } from '@/lib/stale-action';
import { Ban, Plus, X } from 'lucide-react';

interface Account {
  id: string;
  account_id: string;
  account_name: string;
  bm_id: string;
  bm_name: string;
  is_blacklisted?: boolean;
}

interface BlacklistedBm {
  bm_id: string;
  bm_name: string;
}

export default function BlacklistPanel({
  initialAccounts,
  initialBlacklistedBms,
}: {
  initialAccounts: Account[];
  initialBlacklistedBms: BlacklistedBm[];
}) {
  const [accounts, setAccounts] = useState<Account[]>(initialAccounts);
  const [blacklistedBms, setBlacklistedBms] = useState<BlacklistedBm[]>(initialBlacklistedBms);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [showAddBm, setShowAddBm] = useState(false);
  const [accountQuery, setAccountQuery] = useState('');
  const [bmQuery, setBmQuery] = useState('');

  const blacklistedAccounts = useMemo(
    () => accounts.filter(a => a.is_blacklisted),
    [accounts]
  );

  const blacklistedBmSet = useMemo(
    () => new Set(blacklistedBms.map(b => b.bm_id)),
    [blacklistedBms]
  );

  const availableAccounts = useMemo(() => {
    const q = accountQuery.trim().toLowerCase();
    return accounts
      .filter(a => !a.is_blacklisted && !blacklistedBmSet.has(a.bm_id))
      .filter(a =>
        !q ||
        a.account_name.toLowerCase().includes(q) ||
        a.account_id.toLowerCase().includes(q) ||
        (a.bm_name ?? '').toLowerCase().includes(q)
      )
      .sort((a, b) => a.account_name.localeCompare(b.account_name))
      .slice(0, 50);
  }, [accounts, blacklistedBmSet, accountQuery]);

  const availableBms = useMemo(() => {
    const q = bmQuery.trim().toLowerCase();
    const map = new Map<string, { bm_id: string; bm_name: string }>();
    for (const a of accounts) {
      if (!a.bm_id) continue;
      if (blacklistedBmSet.has(a.bm_id)) continue;
      if (!map.has(a.bm_id)) {
        map.set(a.bm_id, { bm_id: a.bm_id, bm_name: a.bm_name });
      }
    }
    return Array.from(map.values())
      .filter(b =>
        !q ||
        b.bm_name.toLowerCase().includes(q) ||
        b.bm_id.toLowerCase().includes(q)
      )
      .sort((a, b) => a.bm_name.localeCompare(b.bm_name))
      .slice(0, 50);
  }, [accounts, blacklistedBmSet, bmQuery]);

  const addAccount = async (acc: Account) => {
    setAccounts(prev => prev.map(a => a.account_id === acc.account_id ? { ...a, is_blacklisted: true } : a));
    try {
      await toggleAccountBlacklist(acc.account_id, true);
      setShowAddAccount(false);
      setAccountQuery('');
    } catch (err) {
      if (handleStaleServerAction(err)) return;
      setAccounts(prev => prev.map(a => a.account_id === acc.account_id ? { ...a, is_blacklisted: false } : a));
      alert('Falha ao adicionar conta à blacklist.');
    }
  };

  const removeAccount = async (acc: Account) => {
    setAccounts(prev => prev.map(a => a.account_id === acc.account_id ? { ...a, is_blacklisted: false } : a));
    try {
      await toggleAccountBlacklist(acc.account_id, false);
    } catch (err) {
      if (handleStaleServerAction(err)) return;
      setAccounts(prev => prev.map(a => a.account_id === acc.account_id ? { ...a, is_blacklisted: true } : a));
      alert('Falha ao remover conta da blacklist.');
    }
  };

  const addBm = async (bm: { bm_id: string; bm_name: string }) => {
    const prev = blacklistedBms;
    setBlacklistedBms([...blacklistedBms, bm]);
    try {
      await toggleBmBlacklist(bm.bm_id, bm.bm_name, true);
      setShowAddBm(false);
      setBmQuery('');
    } catch (err) {
      if (handleStaleServerAction(err)) return;
      setBlacklistedBms(prev);
      alert('Falha ao adicionar BM à blacklist.');
    }
  };

  const removeBm = async (bm: BlacklistedBm) => {
    const prev = blacklistedBms;
    setBlacklistedBms(blacklistedBms.filter(b => b.bm_id !== bm.bm_id));
    try {
      await toggleBmBlacklist(bm.bm_id, bm.bm_name, false);
    } catch (err) {
      if (handleStaleServerAction(err)) return;
      setBlacklistedBms(prev);
      alert('Falha ao remover BM da blacklist.');
    }
  };

  return (
    <div>
      <div className="flex items-end justify-between mb-5">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-gray-800">
            <Ban className="w-4 h-4 text-rose-500" />
            Blacklist
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Contas e BMs aqui ficam ocultos em <span className="font-mono">/status-contas</span>, independente da situação.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* BMs Blacklistados */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b border-gray-100">
            <div>
              <h3 className="text-xs font-bold text-gray-800 uppercase tracking-wider">BMs blacklistados</h3>
              <p className="text-[11px] text-gray-400 mt-0.5">{blacklistedBms.length} item{blacklistedBms.length !== 1 ? 's' : ''}</p>
            </div>
            <button
              onClick={() => { setShowAddBm(v => !v); setShowAddAccount(false); }}
              className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 transition-colors"
            >
              <Plus className="w-3 h-3" /> Adicionar
            </button>
          </div>

          {showAddBm && (
            <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/60">
              <input
                autoFocus
                value={bmQuery}
                onChange={e => setBmQuery(e.target.value)}
                placeholder="Buscar BM por nome ou ID…"
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs outline-none focus:border-indigo-400 bg-white"
              />
              <div className="mt-2 max-h-56 overflow-y-auto flex flex-col gap-1">
                {availableBms.length === 0 ? (
                  <p className="text-[11px] text-gray-400 italic px-1 py-2">Nenhum BM encontrado.</p>
                ) : (
                  availableBms.map(bm => (
                    <button
                      key={bm.bm_id}
                      onClick={() => addBm(bm)}
                      className="text-left px-2 py-1.5 rounded-md hover:bg-rose-50 transition-colors"
                    >
                      <p className="text-xs font-medium text-gray-800 truncate">{bm.bm_name}</p>
                      <p className="text-[10px] text-gray-400 font-mono">{bm.bm_id}</p>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {blacklistedBms.length === 0 ? (
            <p className="px-5 py-6 text-xs text-gray-400 text-center">Nenhum BM blacklistado.</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {blacklistedBms.map(bm => (
                <li key={bm.bm_id} className="flex items-center justify-between px-5 py-2.5">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-800 truncate">{bm.bm_name || '—'}</p>
                    <p className="text-[10px] text-gray-400 font-mono">{bm.bm_id}</p>
                  </div>
                  <button
                    onClick={() => removeBm(bm)}
                    title="Remover da blacklist"
                    className="text-gray-300 hover:text-rose-500 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Contas Blacklistadas */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b border-gray-100">
            <div>
              <h3 className="text-xs font-bold text-gray-800 uppercase tracking-wider">Contas blacklistadas</h3>
              <p className="text-[11px] text-gray-400 mt-0.5">{blacklistedAccounts.length} item{blacklistedAccounts.length !== 1 ? 's' : ''}</p>
            </div>
            <button
              onClick={() => { setShowAddAccount(v => !v); setShowAddBm(false); }}
              className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 transition-colors"
            >
              <Plus className="w-3 h-3" /> Adicionar
            </button>
          </div>

          {showAddAccount && (
            <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/60">
              <input
                autoFocus
                value={accountQuery}
                onChange={e => setAccountQuery(e.target.value)}
                placeholder="Buscar conta por nome, ID ou BM…"
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs outline-none focus:border-indigo-400 bg-white"
              />
              <div className="mt-2 max-h-56 overflow-y-auto flex flex-col gap-1">
                {availableAccounts.length === 0 ? (
                  <p className="text-[11px] text-gray-400 italic px-1 py-2">Nenhuma conta encontrada.</p>
                ) : (
                  availableAccounts.map(acc => (
                    <button
                      key={acc.account_id}
                      onClick={() => addAccount(acc)}
                      className="text-left px-2 py-1.5 rounded-md hover:bg-rose-50 transition-colors"
                    >
                      <p className="text-xs font-medium text-gray-800 truncate">{acc.account_name}</p>
                      <p className="text-[10px] text-gray-400 font-mono">
                        {acc.account_id} · {acc.bm_name}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {blacklistedAccounts.length === 0 ? (
            <p className="px-5 py-6 text-xs text-gray-400 text-center">Nenhuma conta blacklistada.</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {blacklistedAccounts.map(acc => (
                <li key={acc.account_id} className="flex items-center justify-between px-5 py-2.5">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-800 truncate">{acc.account_name}</p>
                    <p className="text-[10px] text-gray-400 font-mono">
                      {acc.account_id} · {acc.bm_name}
                    </p>
                  </div>
                  <button
                    onClick={() => removeAccount(acc)}
                    title="Remover da blacklist"
                    className="text-gray-300 hover:text-rose-500 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
