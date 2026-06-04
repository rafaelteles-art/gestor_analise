import { pool } from '@/lib/db';
import AccountList from './components/AccountList';
import BlacklistPanel from './components/BlacklistPanel';
import MetaSyncPanel from './components/MetaSyncPanel';
import VturbSyncPanel from './components/VturbSyncPanel';
import V2MediaLabLayout from '../components/V2MediaLabLayout';

export const dynamic = 'force-dynamic';

async function ensureBlacklistSchema() {
  await pool.query(
    `ALTER TABLE meta_ad_accounts ADD COLUMN IF NOT EXISTS is_blacklisted BOOLEAN DEFAULT false`
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS meta_bm_blacklist (
       bm_id VARCHAR(64) PRIMARY KEY,
       bm_name VARCHAR(255),
       created_at TIMESTAMP DEFAULT NOW()
     )`
  );
}

export default async function SettingsPage() {
  let accounts: any[] = [];
  let rtCampaigns: any[] = [];
  let blacklistedBms: { bm_id: string; bm_name: string }[] = [];

  try {
    await ensureBlacklistSchema();
    const [accRes, rtRes, bmBlRes] = await Promise.all([
      pool.query(`
        SELECT id, account_id, account_name, bm_id, bm_name, is_selected,
               COALESCE(is_blacklisted, false) AS is_blacklisted
        FROM meta_ad_accounts
        ORDER BY bm_name ASC, account_name ASC
      `),
      pool.query('SELECT * FROM redtrack_campaign_selections ORDER BY campaign_name ASC'),
      pool.query('SELECT bm_id, bm_name FROM meta_bm_blacklist ORDER BY bm_name ASC'),
    ]);
    accounts       = accRes.rows;
    rtCampaigns    = rtRes.rows;
    blacklistedBms = bmBlRes.rows;
  } catch (error) {
    console.error(error);
  }

  return (
    <V2MediaLabLayout title="Configurações">
      <div className="max-w-4xl flex flex-col gap-8">
        <MetaSyncPanel initialRtCampaigns={rtCampaigns} />
        <VturbSyncPanel />
        <AccountList
          initialAccounts={accounts}
          initialBlacklistedBmIds={blacklistedBms.map(b => b.bm_id)}
        />
        <BlacklistPanel
          initialAccounts={accounts}
          initialBlacklistedBms={blacklistedBms}
        />
      </div>
    </V2MediaLabLayout>
  );
}
