import { pool } from '@/lib/db';
import AccountList from './components/AccountList';
import DopScaleLayout from '../components/DopScaleLayout';

export default async function SettingsPage() {
  let accounts: any[] = [];
  try {
    const res = await pool.query('SELECT * FROM meta_ad_accounts ORDER BY bm_name ASC, account_name ASC');
    accounts = res.rows;
  } catch (error) {
    console.error(error);
  }

  return (
    <DopScaleLayout title="Configurações">
      <div className="max-w-4xl">
        <AccountList initialAccounts={accounts || []} />
      </div>
    </DopScaleLayout>
  );
}
