'use client';

import { useState, useTransition } from 'react';
import type { PageDef, Role } from '@/lib/access';
import {
  createUser,
  deleteUser,
  togglePageAccess,
  updateUserRole,
} from './actions';
import { handleStaleServerAction } from '@/lib/stale-action';

export type UserRow = {
  email: string;
  name: string | null;
  role: Role;
  pages: string[];
  createdAt: string;
};

type Props = {
  rows: UserRow[];
  pages: PageDef[];
  currentUserEmail: string;
  currentUserRole: Role;
};

const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  user: 'Usuário',
};

const ROLE_BADGE: Record<Role, string> = {
  super_admin: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/40 dark:text-purple-400 dark:border-purple-800',
  admin: 'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-400 dark:border-indigo-800',
  user: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
};

export default function UsersClient({ rows, pages, currentUserEmail, currentUserRole }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');

  const isSuper = currentUserRole === 'super_admin';

  function run(fn: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
      } catch (err: any) {
        if (handleStaleServerAction(err)) return;
        setError(err?.message ?? 'Erro desconhecido');
      }
    });
  }

  return (
    <div className="max-w-6xl flex flex-col gap-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm dark:bg-red-950/40 dark:border-red-800 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Adicionar usuário */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm dark:bg-gray-900 dark:border-gray-700">
        <h3 className="text-base font-bold text-gray-800 mb-1 dark:text-gray-100">Adicionar usuário</h3>
        <p className="text-xs text-gray-500 mb-4 dark:text-gray-400">
          Apenas e-mails @v2globalteam.com. O usuário precisa fazer login ao menos uma vez para conseguir acessar — se quiser antecipar, cadastre aqui.
        </p>
        <div className="flex flex-col md:flex-row gap-3">
          <input
            type="email"
            placeholder="email@v2globalteam.com"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
          />
          <input
            type="text"
            placeholder="Nome (opcional)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
          />
          <button
            disabled={isPending || !newEmail.trim()}
            onClick={() =>
              run(async () => {
                await createUser(newEmail, newName);
                setNewEmail('');
                setNewName('');
              })
            }
            className="bg-indigo-600 text-white text-sm font-semibold rounded-lg px-5 py-2 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Adicionar
          </button>
        </div>
      </div>

      {/* Lista de usuários */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden dark:bg-gray-900 dark:border-gray-700">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between dark:border-gray-800">
          <div>
            <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">Usuários ({rows.length})</h3>
            <p className="text-xs text-gray-500 mt-0.5 dark:text-gray-400">
              Marque as páginas que cada usuário pode acessar. Super admins acessam tudo automaticamente.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500 tracking-wide dark:bg-gray-800 dark:text-gray-400">
              <tr>
                <th className="text-left px-6 py-3 font-semibold">Usuário</th>
                <th className="text-left px-6 py-3 font-semibold">Nível</th>
                {pages.map((p) => (
                  <th key={p.key} className="text-center px-3 py-3 font-semibold whitespace-nowrap">
                    {p.label}
                  </th>
                ))}
                <th className="text-right px-6 py-3 font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {rows.map((u) => {
                const isSelf = u.email === currentUserEmail;
                const isSuperRow = u.role === 'super_admin';
                const pageSet = new Set(u.pages);

                return (
                  <tr key={u.email} className="hover:bg-gray-50/60 dark:hover:bg-gray-800">
                    <td className="px-6 py-3">
                      <div className="font-medium text-gray-800 dark:text-gray-100">{u.name || u.email.split('@')[0]}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{u.email}</div>
                    </td>
                    <td className="px-6 py-3">
                      {isSuper && !isSelf ? (
                        <select
                          value={u.role}
                          disabled={isPending}
                          onChange={(e) =>
                            run(() => updateUserRole(u.email, e.target.value as Role))
                          }
                          className={`text-xs font-semibold rounded-full border px-3 py-1 ${ROLE_BADGE[u.role]} cursor-pointer`}
                        >
                          <option value="user">Usuário</option>
                          <option value="admin">Admin</option>
                          <option value="super_admin">Super Admin</option>
                        </select>
                      ) : (
                        <span
                          className={`inline-block text-xs font-semibold rounded-full border px-3 py-1 ${ROLE_BADGE[u.role]}`}
                        >
                          {ROLE_LABEL[u.role]}
                        </span>
                      )}
                    </td>
                    {pages.map((p) => {
                      const checked = isSuperRow || pageSet.has(p.key);
                      const locked = isSuperRow; // super admin: acesso total, imutável por página
                      return (
                        <td key={p.key} className="text-center px-3 py-3">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={locked || isPending}
                            onChange={(e) =>
                              run(() => togglePageAccess(u.email, p.key, e.target.checked))
                            }
                            className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800"
                          />
                        </td>
                      );
                    })}
                    <td className="px-6 py-3 text-right">
                      {isSuper && !isSuperRow && !isSelf ? (
                        <button
                          onClick={() => {
                            if (confirm(`Remover ${u.email}?`)) {
                              run(() => deleteUser(u.email));
                            }
                          }}
                          disabled={isPending}
                          className="text-xs text-red-600 hover:text-red-700 hover:underline disabled:opacity-50"
                        >
                          Remover
                        </button>
                      ) : (
                        <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={pages.length + 3} className="px-6 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                    Nenhum usuário cadastrado ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
