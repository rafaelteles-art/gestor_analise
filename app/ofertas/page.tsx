import { pool } from '@/lib/db';
import V2MediaLabLayout from '../components/V2MediaLabLayout';
import ClientOfertas from './ClientOfertas';
import { ensureOfferLinkSchema, backfillMetaAccountOffers } from '@/lib/offer-links';

export const dynamic = 'force-dynamic';

export default async function OfertasPage() {
  let ofertas: any[] = [];
  let campaigns: any[] = [];
  let players: any[] = [];
  let accountLinks: any[] = [];

  try {
    await ensureOfferLinkSchema();
    await backfillMetaAccountOffers();

    const [ofRes, campRes, playRes, accRes] = await Promise.all([
      pool.query(`SELECT id, nome, status, created_at FROM ofertas ORDER BY nome ASC`),
      pool.query(`
        SELECT campaign_id, campaign_name, status, oferta_id
        FROM redtrack_campaign_selections
        ORDER BY campaign_name ASC
      `),
      pool.query(`
        SELECT player_id, player_name, video_duration, oferta_id
        FROM vturb_players
        ORDER BY player_name ASC NULLS LAST
      `),
      pool.query(`
        SELECT mao.oferta_id, mao.account_id, m.account_name, m.bm_name
        FROM meta_account_offers mao
        JOIN meta_ad_accounts m ON m.account_id = mao.account_id
        ORDER BY m.account_name ASC
      `),
    ]);
    ofertas = ofRes.rows;
    campaigns = campRes.rows;
    players = playRes.rows;
    accountLinks = accRes.rows;
  } catch (error) {
    console.error('Erro ao carregar ofertas:', error);
  }

  return (
    <V2MediaLabLayout title="Ofertas">
      <ClientOfertas
        initialOfertas={ofertas}
        campaigns={campaigns}
        players={players}
        accountLinks={accountLinks}
      />
    </V2MediaLabLayout>
  );
}
