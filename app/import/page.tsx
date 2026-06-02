import { pool } from '@/lib/db';
import ClientImport from './ClientImport';
import V2MediaLabLayout from '../components/V2MediaLabLayout';
import { parseOfertaParam } from '@/lib/offer-scope';

export const dynamic = 'force-dynamic';

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ oferta?: string }>;
}) {
  const sp = await searchParams;
  const ofertaId = parseOfertaParam(sp?.oferta);

  let dbAccounts: any[] = [];
  let rtCampaigns: any[] = [];
  let offers: { id: number; nome: string }[] = [];

  try {
    const accSql = ofertaId == null
      ? `SELECT * FROM meta_ad_accounts WHERE account_id IN (SELECT account_id FROM meta_account_offers) ORDER BY bm_name ASC`
      : `SELECT * FROM meta_ad_accounts WHERE account_id IN (SELECT account_id FROM meta_account_offers WHERE oferta_id = $1) ORDER BY bm_name ASC`;
    const campSql = ofertaId == null
      ? `SELECT * FROM redtrack_campaign_selections WHERE oferta_id IS NOT NULL ORDER BY campaign_name ASC`
      : `SELECT * FROM redtrack_campaign_selections WHERE oferta_id = $1 ORDER BY campaign_name ASC`;
    const params = ofertaId == null ? [] : [ofertaId];
    const [accRes, rtRes, ofRes] = await Promise.all([
      pool.query(accSql, params),
      pool.query(campSql, params),
      pool.query(`SELECT id, nome FROM ofertas ORDER BY nome ASC`),
    ]);
    dbAccounts = accRes.rows;
    rtCampaigns = rtRes.rows;
    offers = ofRes.rows;
  } catch (error) {
    console.error('Erro ao puxar dados do GCP Postgres:', error);
  }

  return (
    <V2MediaLabLayout title="Dashboard">
      <ClientImport
        dbAccounts={dbAccounts || []}
        rtCampaigns={rtCampaigns || []}
        offers={offers}
        currentOferta={ofertaId}
      />
    </V2MediaLabLayout>
  );
}
