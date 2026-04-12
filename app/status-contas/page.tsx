import { pool } from '@/lib/db';
import V2MediaLabLayout from '../components/V2MediaLabLayout';
import ClientStatusContas from './ClientStatusContas';

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

  try {
    await ensureColumns();
    const res = await pool.query(`
      SELECT
        id, account_id, account_name, bm_id, bm_name, is_selected,
        COALESCE(etapa, 'Não Utilizada') AS etapa,
        COALESCE(gestor, '{}') AS gestor,
        COALESCE(oferta, '{}') AS oferta,
        cartao,
        COALESCE(moeda, 'BRL') AS moeda,
        COALESCE(limite, 0) AS limite,
        COALESCE(gasto_total, 0) AS gasto_total,
        perfil,
        COALESCE(account_status, 'ACTIVE') AS account_status,
        timezone
      FROM meta_ad_accounts
      ORDER BY bm_name ASC, account_name ASC
    `);
    accounts = res.rows;
  } catch (error) {
    console.error('Erro ao carregar contas:', error);
  }

  return (
    <V2MediaLabLayout title="Status de Contas">
      <ClientStatusContas initialAccounts={accounts} />
    </V2MediaLabLayout>
  );
}
