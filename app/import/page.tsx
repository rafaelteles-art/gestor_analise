import React from 'react';
import { supabase } from '@/lib/supabase';
import ClientImport from './ClientImport';

export default async function ImportPage() {
  // Puxar todas as contas direto do banco. 
  // Na lógica real depois usaremos a listagem de is_selected pra filtrar o escopo ativo
  const { data: dbAccounts, error } = await supabase
    .from('meta_ad_accounts')
    .select('*')
    .eq('is_selected', true)
    .order('bm_name', { ascending: true });

  const { data: rtCampaigns, error: rtError } = await supabase
    .from('redtrack_campaign_selections')
    .select('*')
    .order('campaign_name', { ascending: true });

  if (error || rtError) {
    console.error("Erro ao puxar dados do Supabase:", error, rtError);
  }

  return (
    <div className="flex min-h-screen bg-[#f4f7fb] text-gray-800 font-sans">
      {/* Sidebar - DopScale Style */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col hidden md:flex">
        <div className="p-6">
          <h1 className="text-xl font-bold flex items-center text-indigo-600 tracking-wide gap-2">
             DopScale <span className="text-xs text-gray-400 font-normal mt-1">v.Pro</span>
          </h1>
        </div>
        <nav className="flex-1 px-4 space-y-1">
          <a href="#" className="flex items-center gap-3 px-3 py-2.5 bg-indigo-50 text-indigo-600 rounded-lg font-medium text-sm">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
            Dashboard
          </a>
          <a href="#" className="flex items-center gap-3 px-3 py-2.5 text-gray-600 hover:bg-gray-50 rounded-lg font-medium text-sm transition-colors">
            <svg className="w-5 h-5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
            Otimizar
          </a>
          <a href="#" className="flex items-center gap-3 px-3 py-2.5 text-gray-600 hover:bg-gray-50 rounded-lg font-medium text-sm transition-colors">
            <svg className="w-5 h-5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            Configurações
          </a>
        </nav>
        <div className="p-4 border-t border-gray-100 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-sm">TU</div>
            <div className="text-sm">
                <p className="font-semibold text-gray-800 leading-tight">Test User</p>
                <p className="text-xs text-gray-500">Test Organization</p>
            </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col w-full overflow-x-hidden">
        {/* Header Branco */}
        <header className="bg-white h-16 border-b border-gray-200 px-8 flex items-center">
            <h2 className="text-lg font-bold text-gray-800">Dashboard</h2>
        </header>

        {/* Content Area */}
        <div className="p-8 h-full">
            <ClientImport dbAccounts={dbAccounts || []} rtCampaigns={rtCampaigns || []} />
        </div>
      </main>
    </div>
  );
}
