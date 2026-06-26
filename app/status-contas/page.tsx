import { pool } from '@/lib/db';
import V2MediaLabLayout from '../components/V2MediaLabLayout';
import ClientStatusContas from './ClientStatusContas';
import { ensureOfferLinkSchema, backfillMetaAccountOffers } from '@/lib/offer-links';
import { getAccountSyncStatus, type AccountSyncStatus } from '@/lib/account-sync';

export const dynamic = 'force-dynamic';

async function ensureColumns() {
  const alterQueries = [
    `ALTER TABLE meta_ad_accounts ADD COLUMN IF NOT EXISTS etapa VARCHAR(50) DEFAULT 'Não Utilizada'`,
    `ALTER TABLE meta_ad_accounts ADD COLUMN IF NOT EXISTS cartao VARCHAR(100)`,
    `ALTER TABLE meta_ad_accounts ADD COLUMN IF NOT EXISTS moeda VARCHAR(10) DEFAULT 'BRL'`,
    `ALTER TABLE meta_ad_accounts ADD COLUMN IF NOT EXISTS limite NUMERIC(15,2) DEFAULT 0`,
    `ALTER TABLE meta_ad_accounts ADD COLUMN IF NOT EXISTS gasto_total NUMERIC(15,2) DEFAULT 0`,
    `ALTER TABLE meta_ad_accounts ADD COLUMN IF NOT EXISTS perfil VARCHAR(50)`,
    `ALTER TABLE meta_ad_accounts ADD COLUMN IF NOT EXISTS account_status VARCHAR(50) DEFAULT 'ACTIVE'`,
    `ALTER TABLE meta_ad_accounts ALTER COLUMN account_status TYPE VARCHAR(50)`,
    `ALTER TABLE meta_ad_accounts ADD COLUMN IF NOT EXISTS gestor TEXT[]`,
    `ALTER TABLE meta_ad_accounts ADD COLUMN IF NOT EXISTS oferta TEXT[]`,
    `ALTER TABLE meta_ad_accounts ADD COLUMN IF NOT EXISTS timezone VARCHAR(100)`,
    `ALTER TABLE meta_ad_accounts ADD COLUMN IF NOT EXISTS is_blacklisted BOOLEAN DEFAULT false`,
    `ALTER TABLE meta_ad_accounts ADD COLUMN IF NOT EXISTS nickname TEXT`,
    `ALTER TABLE meta_ad_accounts ADD COLUMN IF NOT EXISTS accessible_profiles TEXT[] DEFAULT '{}'`,
    `CREATE TABLE IF NOT EXISTS meta_bm_blacklist (
       bm_id VARCHAR(64) PRIMARY KEY,
       bm_name VARCHAR(255),
       created_at TIMESTAMP DEFAULT NOW()
     )`,
  ];
  for (const q of alterQueries) {
    await pool.query(q);
  }
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'meta_ad_accounts' AND column_name = 'gestor' AND data_type = 'character varying'
      ) THEN
        ALTER TABLE meta_ad_accounts ALTER COLUMN gestor TYPE TEXT[]
          USING CASE WHEN gestor IS NULL OR gestor = '' THEN NULL ELSE ARRAY[gestor] END;
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'meta_ad_accounts' AND column_name = 'oferta' AND data_type = 'character varying'
      ) THEN
        ALTER TABLE meta_ad_accounts ALTER COLUMN oferta TYPE TEXT[]
          USING CASE WHEN oferta IS NULL OR oferta = '' THEN NULL ELSE ARRAY[oferta] END;
      END IF;
    END $$;
  `);
}

export default async function StatusContasPage() {
  let accounts: any[] = [];
  let ofertasOptions: { value: string; label: string }[] = [];
  let lastSync: AccountSyncStatus | null = null;

  try {
    await ensureColumns();
    await ensureOfferLinkSchema();
    await backfillMetaAccountOffers();
    lastSync = await getAccountSyncStatus();
    const [accRes, ofertasRes] = await Promise.all([
      pool.query(`
        SELECT
          id, account_id, account_name, bm_id, bm_name, is_selected,
          COALESCE(etapa, 'Não Utilizada') AS etapa,
          COALESCE(gestor, '{}') AS gestor,
          COALESCE(
            (SELECT array_agg(mao.oferta_id ORDER BY mao.oferta_id)
             FROM meta_account_offers mao WHERE mao.account_id = meta_ad_accounts.account_id),
            '{}'
          ) AS oferta_ids,
          cartao,
          COALESCE(moeda, 'BRL') AS moeda,
          COALESCE(gasto_total, 0) AS gasto_total,
          perfil,
          COALESCE(account_status, 'ACTIVE') AS account_status,
          timezone,
          nickname,
          COALESCE(accessible_profiles, '{}') AS accessible_profiles
        FROM meta_ad_accounts
        WHERE COALESCE(is_blacklisted, false) = false
          AND bm_id NOT IN (SELECT bm_id FROM meta_bm_blacklist)
        ORDER BY bm_name ASC, account_name ASC
      `),
      pool.query(`
        SELECT id, nome FROM ofertas WHERE status = 'ATIVO' ORDER BY nome ASC
      `).catch(() => ({ rows: [] as { id: number; nome: string }[] })),
    ]);
    accounts = accRes.rows;
    ofertasOptions = ofertasRes.rows.map((r: { id: number; nome: string }) => ({ value: String(r.id), label: r.nome }));
  } catch (error) {
    console.error('Erro ao carregar contas:', error);
  }

  return (
    <V2MediaLabLayout title="Status de Contas">
      <ClientStatusContas initialAccounts={accounts} ofertasOptions={ofertasOptions} lastSync={lastSync} />
    </V2MediaLabLayout>
  );
}
