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
          <h2 className="text-xl font-semibold text-gray-800">Linked Ad Accounts</h2>
          <div className="flex gap-3 mt-3">
            <button 
              onClick={() => handleToggleAll(true)}
              className="flex items-center gap-1.5 text-xs text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors border border-transparent shadow-sm"
            >
              <CheckSquare className="w-3.5 h-3.5" /> Ativar Todas
            </button>
            <button 
              onClick={() => handleToggleAll(false)}
              className="flex items-center gap-1.5 text-xs text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 px-3 py-1.5 rounded-lg transition-colors shadow-sm"
            >
              <Square className="w-3.5 h-3.5" /> Desativar Todas
            </button>
          </div>
        </div>
        <button 
          onClick={syncAccounts} 
          disabled={isSyncing}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 shadow-sm rounded-xl text-sm font-medium text-white transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
          {isSyncing ? 'Scanning Meta...' : 'Scan New Accounts'}
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        {accounts.length === 0 ? (
          <div className="p-12 text-center text-gray-400 text-sm">
            Nenhuma conta mapeada. Clique em "Scan New Accounts" para mapear do Facebook.
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 text-[10px] uppercase tracking-wider font-bold">
                <th className="px-6 py-4 font-bold">Conta</th>
                <th className="px-6 py-4 font-bold">Business Manager</th>
                <th className="px-6 py-4 font-bold">Status / Toggle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {accounts.map((acc) => (
                <tr key={acc.account_id} className="hover:bg-gray-50 transition-colors text-sm">
                  <td className="px-6 py-4">
                    <p className="font-bold text-gray-800">{acc.account_name}</p>
                    <p className="text-[11px] text-gray-400 font-mono mt-1">{acc.account_id}</p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-gray-600">{acc.bm_name}</p>
                    <p className="text-[11px] text-gray-400 font-mono mt-1">{acc.bm_id}</p>
                  </td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => handleToggle(acc.account_id, acc.is_selected)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                        acc.is_selected ? 'bg-indigo-600' : 'bg-gray-200'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          acc.is_selected ? 'translate-x-6' : 'translate-x-1'
                        } shadow-sm`}
                      />
                    </button>
                    {acc.is_selected && <span className="ml-3 text-xs text-emerald-600 font-bold inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5"/> Ativa</span>}
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
