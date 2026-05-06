import { pool } from '@/lib/db';
import ClientImportV2 from './ClientImportV2';
import V2MediaLabLayout from '../components/V2MediaLabLayout';

export default async function ImportV2Page() {
  let dbAccounts: any[] = [];
  let rtCampaigns: any[] = [];

  try {
    const accRes = await pool.query("SELECT * FROM meta_ad_accounts WHERE is_selected = true ORDER BY bm_name ASC");
    dbAccounts = accRes.rows;

    const rtRes = await pool.query("SELECT * FROM redtrack_campaign_selections ORDER BY campaign_name ASC");
    rtCampaigns = rtRes.rows;
  } catch (error) {
    console.error("Erro ao puxar dados do GCP Postgres:", error);
  }

  return (
    <V2MediaLabLayout title="Dashboard V2">
      <ClientImportV2 dbAccounts={dbAccounts || []} rtCampaigns={rtCampaigns || []} />
    </V2MediaLabLayout>
  );
}
