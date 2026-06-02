import { pool } from '@/lib/db';
import V2MediaLabLayout from '../components/V2MediaLabLayout';
import ClientOverview from './ClientOverview';
import { parseOfertaParam } from '@/lib/offer-scope';

export const dynamic = 'force-dynamic';

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ oferta?: string }>;
}) {
  const sp = await searchParams;
  const ofertaId = parseOfertaParam(sp?.oferta);

  let selectedCampaigns: { campaign_id: string; campaign_name: string; status: string }[] = [];
  let offers: { id: number; nome: string }[] = [];

  try {
    const campSql = ofertaId == null
      ? `SELECT campaign_id, campaign_name, status
         FROM redtrack_campaign_selections
         WHERE oferta_id IN (SELECT id FROM ofertas WHERE status = 'ATIVO')
         ORDER BY campaign_name ASC`
      : `SELECT campaign_id, campaign_name, status
         FROM redtrack_campaign_selections
         WHERE oferta_id = $1
         ORDER BY campaign_name ASC`;
    const [campRes, ofRes] = await Promise.all([
      pool.query(campSql, ofertaId == null ? [] : [ofertaId]),
      pool.query(`SELECT id, nome FROM ofertas WHERE status = 'ATIVO' ORDER BY nome ASC`),
    ]);
    selectedCampaigns = campRes.rows;
    offers = ofRes.rows;
  } catch (err) {
    console.error('Erro ao carregar campanhas para Overview:', err);
  }

  return (
    <V2MediaLabLayout title="Overview">
      <ClientOverview selectedCampaigns={selectedCampaigns} offers={offers} currentOferta={ofertaId} />
    </V2MediaLabLayout>
  );
}
