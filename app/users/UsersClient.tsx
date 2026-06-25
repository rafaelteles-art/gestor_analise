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
  admin: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  user: 'bg-console-surface-2 text-foreground border-console-border',
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
        <div className="bg-red-50 border border-red-200 text-red-700 rounded px-4 py-3 text-sm dark:bg-red-950/40 dark:border-red-800 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Adicionar usuário */}
      <div className="bg-console-surface border border-console-border rounded p-6">
        <h3 className="text-base font-bold text-foreground mb-1">Adicionar usuário</h3>
        <p className="text-xs text-console-muted mb-4">
          Apenas e-mails @v2globalteam.com. O usuário precisa fazer login ao menos uma vez para conseguir acessar — se quiser antecipar, cadastre aqui.
        </p>
        <div className="flex flex-col md:flex-row gap-3">
          <input
            type="email"
            placeholder="email@v2globalteam.com"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            className="flex-1 border border-console-border rounded bg-background text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 placeholder:text-console-muted"
          />
          <input
            type="text"
            placeholder="Nome (opcional)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1 border border-console-border rounded bg-background text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 placeholder:text-console-muted"
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
            className="bg-amber-500 text-black text-sm font-semibold rounded px-5 py-2 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Adicionar
          </button>
        </div>
      </div>

      {/* Lista de usuários */}
      <div className="bg-console-surface border border-console-border rounded overflow-hidden">
        <div className="px-6 py-4 border-b border-console-border flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-foreground">Usuários ({rows.length})</h3>
            <p className="text-xs text-console-muted mt-0.5">
              Marque as páginas que cada usuário pode acessar. Super admins acessam tudo automaticamente.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-console-surface-2 text-xs uppercase text-console-muted tracking-wide">
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
            <tbody className="divide-y divide-console-border">
              {rows.map((u) => {
                const isSelf = u.email === currentUserEmail;
                const isSuperRow = u.role === 'super_admin';
                const pageSet = new Set(u.pages);

                return (
                  <tr key={u.email} className="hover:bg-console-surface-2">
                    <td className="px-6 py-3">
                      <div className="font-medium text-foreground">{u.name || u.email.split('@')[0]}</div>
                      <div className="text-xs text-console-muted">{u.email}</div>
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
                            className="w-4 h-4 rounded border-console-border text-amber-500 focus:ring-amber-500 disabled:opacity-60"
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
                        <span className="text-xs text-console-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={pages.length + 3} className="px-6 py-10 text-center text-sm text-console-muted">
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
