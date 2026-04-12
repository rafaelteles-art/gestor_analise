import { pool } from '@/lib/db';
import AccountList from './components/AccountList';
import MetaSyncPanel from './components/MetaSyncPanel';
import V2MediaLabLayout from '../components/V2MediaLabLayout';

export default async function SettingsPage() {
  let accounts: any[] = [];
  let rtCampaigns: any[] = [];

  try {
    const [accRes, rtRes] = await Promise.all([
      pool.query('SELECT * FROM meta_ad_accounts ORDER BY bm_name ASC, account_name ASC'),
      pool.query('SELECT * FROM redtrack_campaign_selections ORDER BY campaign_name ASC'),
    ]);
    accounts    = accRes.rows;
    rtCampaigns = rtRes.rows;
  } catch (error) {
    console.error(error);
  }

  return (
    <V2MediaLabLayout title="Configurações">
      <div className="max-w-4xl flex flex-col gap-8">
        <MetaSyncPanel initialRtCampaigns={rtCampaigns} />
        <AccountList initialAccounts={accounts} />
      </div>
    </V2MediaLabLayout>
  );
}
