'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import type { Role } from '@/lib/access';
import ThemeToggle from './ThemeToggle';

type NavItem = {
  href: string;
  label: string;
  pageKey: string;
  icon: React.ReactNode;
};

const MAIN_NAV: NavItem[] = [
  {
    href: '/overview',
    label: 'Overview',
    pageKey: 'overview',
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
    ),
  },
  {
    href: '/import',
    label: 'Dashboard',
    pageKey: 'import',
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
    ),
  },
  {
    href: '/importv2',
    label: 'Dashboard V2',
    pageKey: 'importv2',
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
    ),
  },
  {
    href: '/status-contas',
    label: 'Status de Contas',
    pageKey: 'status-contas',
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
    ),
  },
  {
    href: '/paginas',
    label: 'Páginas',
    pageKey: 'paginas',
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2zM9 7h6M9 11h6M9 15h4" /></svg>
    ),
  },
  {
    href: '/analise',
    label: 'Análise',
    pageKey: 'analise',
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
    ),
  },
  {
    href: '/ofertas',
    label: 'Ofertas',
    pageKey: 'ofertas',
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>
    ),
  },
  {
    href: '/catalogo',
    label: 'Catálogo Facebook',
    pageKey: 'catalogo',
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
    ),
  },
  {
    href: '/campaigns',
    label: 'Criar campanha',
    pageKey: 'campaigns',
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" /></svg>
    ),
  },
  {
    href: '/campaigns/fila',
    label: 'Fila de campanhas',
    pageKey: 'campaigns',
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h10M4 18h10" /></svg>
    ),
  },
  {
    href: '/settings',
    label: 'Configurações',
    pageKey: 'settings',
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
    ),
  },
  {
    href: '/api-config',
    label: 'Tokens',
    pageKey: 'api-config',
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
    ),
  },
  {
    href: '/data-studio',
    label: 'Data Studio',
    pageKey: 'data-studio',
    icon: (
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6m6 6V9m6 10V5M3 21h18" /></svg>
    ),
  },
];

const USERS_NAV: NavItem = {
  href: '/users',
  label: 'Usuários',
  pageKey: 'users',
  icon: (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
  ),
};

export default function V2MediaLabLayout({ children, title }: { children: React.ReactNode, title: string }) {
  const pathname = usePathname();
  const { data: session } = useSession();

  const user = session?.user;
  const role = (user as any)?.role as Role | undefined;
  const allowedPages = ((user as any)?.allowedPages as string[] | undefined) ?? [];

  const isAdmin = role === 'admin' || role === 'super_admin';
  const isSuper = role === 'super_admin';

  const visibleNav = MAIN_NAV.filter((item) => {
    if (isSuper) return true;
    return allowedPages.includes(item.pageKey);
  });

  const initials = user?.name
    ? user.name.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()
    : '??';

  return (
    <div className="flex min-h-screen bg-console-surface-2 text-foreground font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-console-surface border-r border-console-border flex flex-col hidden md:flex min-h-screen">
        <div className="p-6">
          <div className="flex items-center gap-3">
            <Image
              src="/v2medialab-logo.jpeg"
              alt="V2 Media Lab"
              width={40}
              height={40}
              className="rounded-full object-cover"
            />
            <div>
              <p className="text-sm font-bold text-foreground leading-tight">V2 Media Lab</p>
              <p className="text-[10px] text-console-muted font-medium tracking-wider uppercase">Analytics</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-4 space-y-1">
          {visibleNav.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded font-medium text-sm transition-colors ${active ? 'bg-amber-500/10 text-amber-400' : 'text-console-muted hover:bg-console-surface-2'}`}
              >
                <span className={`w-5 h-5 ${active ? '' : 'opacity-70'}`}>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}

          {isAdmin && (
            <>
              <div className="pt-4 pb-1 px-3 text-[10px] font-semibold text-console-muted uppercase tracking-wider">
                Administração
              </div>
              <Link
                href={USERS_NAV.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded font-medium text-sm transition-colors ${pathname === USERS_NAV.href ? 'bg-amber-500/10 text-amber-400' : 'text-console-muted hover:bg-console-surface-2'}`}
              >
                <span className={`w-5 h-5 ${pathname === USERS_NAV.href ? '' : 'opacity-70'}`}>{USERS_NAV.icon}</span>
                {USERS_NAV.label}
              </Link>
            </>
          )}
        </nav>

        {/* User info + logout */}
        <div className="p-4 border-t border-console-border">
          <div className="flex items-center gap-3">
            {user?.image ? (
              <Image
                src={user.image}
                alt={user.name ?? 'Usuário'}
                width={32}
                height={32}
                className="rounded-full object-cover"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-amber-500 text-white flex items-center justify-center font-bold text-sm shrink-0">
                {initials}
              </div>
            )}
            <div className="text-sm min-w-0 flex-1">
              <p className="font-semibold text-foreground leading-tight truncate">{user?.name ?? 'Carregando...'}</p>
              <p className="text-xs text-console-muted truncate">{user?.email ?? ''}</p>
            </div>
          </div>
          {role && (
            <div className="mt-2 text-[10px] font-semibold text-console-muted uppercase tracking-wider">
              {role === 'super_admin' ? 'Super Admin' : role === 'admin' ? 'Admin' : 'Usuário'}
            </div>
          )}
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="mt-3 w-full flex items-center justify-center gap-2 text-xs text-console-muted hover:text-red-500 hover:bg-red-500/10 rounded px-3 py-2 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sair
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col w-full overflow-x-hidden min-h-screen">
        {/* Header */}
        <header className="bg-console-surface h-16 border-b border-console-border px-8 flex items-center justify-between shrink-0">
            <h2 className="text-lg font-bold text-foreground">{title}</h2>
            <ThemeToggle />
        </header>

        {/* Content Area */}
        <div className="p-8 h-full flex-1">
            {children}
        </div>
      </main>
    </div>
  );
}
