import { pool } from '@/lib/db';
import V2MediaLabLayout from '../components/V2MediaLabLayout';
import ClientOverview from './ClientOverview';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  let selectedCampaigns: { campaign_id: string; campaign_name: string; status: string }[] = [];

  try {
    const res = await pool.query(
      `SELECT campaign_id, campaign_name, status
       FROM redtrack_campaign_selections
       WHERE is_selected = true
       ORDER BY campaign_name ASC`,
    );
    selectedCampaigns = res.rows;
  } catch (err) {
    console.error('Erro ao carregar campanhas selecionadas para Overview:', err);
  }

  return (
    <V2MediaLabLayout title="Overview">
      <ClientOverview selectedCampaigns={selectedCampaigns} />
    </V2MediaLabLayout>
  );
}
