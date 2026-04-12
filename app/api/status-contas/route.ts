import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

const ALLOWED_FIELDS = ['etapa', 'gestor', 'oferta', 'cartao', 'moeda', 'limite', 'gasto_total', 'perfil', 'account_status'];

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
    // Cria como TEXT[] para novas instalações; instâncias com VARCHAR migram abaixo
    `ALTER TABLE meta_ad_accounts ADD COLUMN IF NOT EXISTS gestor TEXT[]`,
    `ALTER TABLE meta_ad_accounts ADD COLUMN IF NOT EXISTS oferta TEXT[]`,
    `ALTER TABLE meta_ad_accounts ADD COLUMN IF NOT EXISTS timezone VARCHAR(100)`,
  ];
  for (const q of alterQueries) {
    await pool.query(q);
  }
  // Migra gestor/oferta de VARCHAR → TEXT[] se a instalação já existia
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

export async function GET() {
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
    return NextResponse.json({ success: true, accounts: res.rows });
  } catch (error: any) {
    console.error('GET /api/status-contas error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { field, value } = body;

    if (!ALLOWED_FIELDS.includes(field)) {
      return NextResponse.json({ success: false, error: 'Campo inválido' }, { status: 400 });
    }

    // Batch update
    if (Array.isArray(body.account_ids) && body.account_ids.length > 0) {
      const placeholders = body.account_ids.map((_: string, i: number) => `$${i + 2}`).join(', ');
      await pool.query(
        `UPDATE meta_ad_accounts SET ${field} = $1 WHERE account_id IN (${placeholders})`,
        [value, ...body.account_ids]
      );
      return NextResponse.json({ success: true, updated: body.account_ids.length });
    }

    // Single update
    if (!body.account_id) {
      return NextResponse.json({ success: false, error: 'account_id obrigatório' }, { status: 400 });
    }
    await pool.query(
      `UPDATE meta_ad_accounts SET ${field} = $1 WHERE account_id = $2`,
      [value, body.account_id]
    );
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('PATCH /api/status-contas error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureColumns();
    const body = await req.json();
    const { account_id, account_name, bm_id, bm_name, etapa, moeda, perfil } = body;

    if (!account_id || !account_name) {
      return NextResponse.json({ success: false, error: 'account_id e account_name são obrigatórios' }, { status: 400 });
    }

    await pool.query(
      `INSERT INTO meta_ad_accounts (account_id, account_name, bm_id, bm_name, is_selected, etapa, moeda, perfil, account_status)
       VALUES ($1, $2, $3, $4, false, $5, $6, $7, 'ACTIVE')
       ON CONFLICT (account_id) DO UPDATE SET
         account_name = EXCLUDED.account_name,
         bm_name = COALESCE(EXCLUDED.bm_name, meta_ad_accounts.bm_name),
         etapa = COALESCE(EXCLUDED.etapa, meta_ad_accounts.etapa),
         moeda = COALESCE(EXCLUDED.moeda, meta_ad_accounts.moeda),
         perfil = COALESCE(EXCLUDED.perfil, meta_ad_accounts.perfil)`,
      [
        account_id,
        account_name,
        bm_id || '',
        bm_name || '',
        etapa || 'Não Utilizada',
        moeda || 'BRL',
        perfil || null,
      ]
    );
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('POST /api/status-contas error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
