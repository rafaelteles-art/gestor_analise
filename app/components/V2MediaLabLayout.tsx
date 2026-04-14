'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';

export default function V2MediaLabLayout({ children, title }: { children: React.ReactNode, title: string }) {
  const pathname = usePathname();
  const { data: session } = useSession();

  const user = session?.user;
  const initials = user?.name
    ? user.name.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()
    : '??';

  return (
    <div className="flex min-h-screen bg-[#f4f7fb] text-gray-800 font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col hidden md:flex min-h-screen">
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
              <p className="text-sm font-bold text-gray-900 leading-tight">V2 Media Lab</p>
              <p className="text-[10px] text-gray-400 font-medium tracking-wider uppercase">Analytics</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-4 space-y-1">
          <Link href="/import" className={`flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium text-sm transition-colors ${pathname === '/import' ? 'bg-indigo-50 text-indigo-600' : 'text-gray-600 hover:bg-gray-50'}`}>
            <svg className={`w-5 h-5 ${pathname === '/import' ? '' : 'opacity-70'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
            Dashboard
          </Link>
          <Link href="/status-contas" className={`flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium text-sm transition-colors ${pathname === '/status-contas' ? 'bg-indigo-50 text-indigo-600' : 'text-gray-600 hover:bg-gray-50'}`}>
            <svg className={`w-5 h-5 ${pathname === '/status-contas' ? '' : 'opacity-70'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
            Status de Contas
          </Link>
          <Link href="/ofertas" className={`flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium text-sm transition-colors ${pathname === '/ofertas' ? 'bg-indigo-50 text-indigo-600' : 'text-gray-600 hover:bg-gray-50'}`}>
            <svg className={`w-5 h-5 ${pathname === '/ofertas' ? '' : 'opacity-70'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>
            Ofertas
          </Link>
          <Link href="/settings" className={`flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium text-sm transition-colors ${pathname === '/settings' ? 'bg-indigo-50 text-indigo-600' : 'text-gray-600 hover:bg-gray-50'}`}>
            <svg className={`w-5 h-5 ${pathname === '/settings' ? '' : 'opacity-70'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
            Contas de anúncios
          </Link>
          <Link href="/api-config" className={`flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium text-sm transition-colors ${pathname === '/api-config' ? 'bg-indigo-50 text-indigo-600' : 'text-gray-600 hover:bg-gray-50'}`}>
            <svg className={`w-5 h-5 ${pathname === '/api-config' ? '' : 'opacity-70'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            Configurações
          </Link>
        </nav>

        {/* User info + logout */}
        <div className="p-4 border-t border-gray-100">
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
              <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-sm shrink-0">
                {initials}
              </div>
            )}
            <div className="text-sm min-w-0 flex-1">
              <p className="font-semibold text-gray-800 leading-tight truncate">{user?.name ?? 'Carregando...'}</p>
              <p className="text-xs text-gray-500 truncate">{user?.email ?? ''}</p>
            </div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="mt-3 w-full flex items-center justify-center gap-2 text-xs text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg px-3 py-2 transition-colors"
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
        <header className="bg-white h-16 border-b border-gray-200 px-8 flex items-center shadow-sm shrink-0">
            <h2 className="text-lg font-bold text-gray-800">{title}</h2>
        </header>

        {/* Content Area */}
        <div className="p-8 h-full flex-1">
            {children}
        </div>
      </main>
    </div>
  );
}
