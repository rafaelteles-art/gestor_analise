'use client'

import { useState } from 'react';
import { toggleAccountSelection, toggleAllAccountsSelection } from '../actions';
import { RefreshCw, CheckCircle2, CheckSquare, Square } from 'lucide-react';

interface Account {
  id: string;
  account_id: string;
  account_name: string;
  bm_id: string;
  bm_name: string;
  is_selected: boolean;
}

export default function AccountList({ initialAccounts }: { initialAccounts: Account[] }) {
  const [accounts, setAccounts] = useState<Account[]>(initialAccounts);
  const [isSyncing, setIsSyncing] = useState(false);

  const handleToggle = async (accountId: string, currentStatus: boolean) => {
    // optimistic update
    const newStatus = !currentStatus;
    setAccounts(accounts.map(acc => 
      acc.account_id === accountId ? { ...acc, is_selected: newStatus } : acc
    ));

    try {
      await toggleAccountSelection(accountId, newStatus);
    } catch (err) {
      console.error(err);
      // revert switch on error
      setAccounts(accounts.map(acc => 
        acc.account_id === accountId ? { ...acc, is_selected: currentStatus } : acc
      ));
      alert("Failed to update status");
    }
  };

  const syncAccounts = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch('/api/accounts/sync');
      const data = await res.json();
      if(data.success) {
        alert(data.message);
        window.location.reload(); // Quick refresh to get new server data
      } else {
        alert("Error syncing: " + data.error);
      }
    } catch (err) {
      console.error(err);
      alert("Network error");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleToggleAll = async (newStatus: boolean) => {
    const previousAccounts = [...accounts];
    setAccounts(accounts.map(acc => ({ ...acc, is_selected: newStatus })));
    try {
      await toggleAllAccountsSelection(newStatus);
    } catch (err) {
      console.error(err);
      setAccounts(previousAccounts);
      alert("Failed to update all statuses");
    }
  };

  return (
    <div>
      <div className="flex justify-between items-end mb-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-200">Linked Ad Accounts</h2>
          <div className="flex gap-3 mt-3">
            <button 
              onClick={() => handleToggleAll(true)}
              className="flex items-center gap-1.5 text-xs text-indigo-400 bg-indigo-500/10 hover:bg-indigo-500/20 px-3 py-1.5 rounded-lg transition-colors"
            >
              <CheckSquare className="w-3.5 h-3.5" /> Ativar Todas
            </button>
            <button 
              onClick={() => handleToggleAll(false)}
              className="flex items-center gap-1.5 text-xs text-gray-400 bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Square className="w-3.5 h-3.5" /> Desativar Todas
            </button>
          </div>
        </div>
        <button 
          onClick={syncAccounts} 
          disabled={isSyncing}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-600/30 rounded-xl text-sm font-medium text-white transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
          {isSyncing ? 'Scanning Meta...' : 'Scan New Accounts'}
        </button>
      </div>

      <div className="bg-gray-900/40 border border-gray-800 rounded-2xl overflow-hidden shadow-2xl">
        {accounts.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            Nenhuma conta mapeada. Clique em "Scan New Accounts" para mapear do Facebook.
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-900/60 text-gray-400 text-xs uppercase tracking-wider">
                <th className="px-6 py-4 font-medium">Conta</th>
                <th className="px-6 py-4 font-medium">Business Manager</th>
                <th className="px-6 py-4 font-medium">Status / Toggle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {accounts.map((acc) => (
                <tr key={acc.account_id} className="hover:bg-gray-800/30 transition-colors">
                  <td className="px-6 py-4">
                    <p className="font-medium text-gray-200">{acc.account_name}</p>
                    <p className="text-xs text-gray-500 font-mono mt-1">{acc.account_id}</p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-gray-300 text-sm">{acc.bm_name}</p>
                    <p className="text-xs text-gray-500 font-mono mt-1">{acc.bm_id}</p>
                  </td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => handleToggle(acc.account_id, acc.is_selected)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-900 ${
                        acc.is_selected ? 'bg-indigo-500' : 'bg-gray-700'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          acc.is_selected ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                    {acc.is_selected && <span className="ml-3 text-xs text-emerald-400 font-medium inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/> Active</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
