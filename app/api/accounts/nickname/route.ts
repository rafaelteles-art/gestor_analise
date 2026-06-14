import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/accounts/nickname
 * Body: { account_id: string; nickname: string }
 *
 * Salva um apelido livre para a conta Meta. String vazia limpa o apelido (NULL).
 * Não sobrescreve outros campos — o sync de contas preserva nickname via upsert
 * parcial em lib/meta-accounts.ts.
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { account_id, nickname } = body as { account_id?: string; nickname?: string };

    if (!account_id || typeof account_id !== 'string') {
      return NextResponse.json({ success: false, error: 'account_id obrigatório' }, { status: 400 });
    }

    // NOTE: Schema is ensured at page-load time via ensureColumns() in the server
    // components (status-contas/page.tsx, campaigns/page.tsx). Running ALTER TABLE
    // on the hot-path of every write would acquire ACCESS EXCLUSIVE locks on
    // meta_ad_accounts and contend with the hourly account-sync cron transactions.

    // NULLIF(trim($2), '') → empty string becomes NULL (clears the nickname)
    await pool.query(
      `UPDATE meta_ad_accounts SET nickname = NULLIF(trim($2), '') WHERE account_id = $1`,
      [account_id, typeof nickname === 'string' ? nickname : '']
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('PATCH /api/accounts/nickname error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
