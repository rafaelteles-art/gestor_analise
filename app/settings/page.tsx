import { supabase } from '@/lib/supabase';
import AccountList from './components/AccountList';

export default async function SettingsPage() {
  const { data: accounts, error } = await supabase
    .from('meta_ad_accounts')
    .select('*')
    .order('bm_name', { ascending: true })
    .order('account_name', { ascending: true });

  if (error) {
    console.error(error);
  }

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-gray-100 p-8">
      <header className="max-w-4xl mx-auto mb-10">
        <h1 className="text-3xl font-extrabold text-white tracking-tight">Configuration</h1>
        <p className="text-gray-400 mt-2">Manage your data integrations and selected ad accounts.</p>
      </header>
      
      <main className="max-w-4xl mx-auto space-y-10">
        <AccountList initialAccounts={accounts || []} />
      </main>
    </div>
  );
}
