import { NextResponse } from 'next/server';
import { listCatalogs } from '@/lib/meta-campaigns';
import { pool } from '@/lib/db';
import { resolveAuth } from '../_helpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/campaigns/catalogs?account_id=act_xxx&profile_name=Foo
 * Lista catálogos do BM ao qual a conta de anúncios pertence.
 * Usado pelo seletor de DPA ("Usar catálogo existente").
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get('account_id');
  const profileName = searchParams.get('profile_name');
  if (!accountId) return NextResponse.json({ error: 'account_id obrigatório' }, { status: 400 });

  const auth = await resolveAuth(accountId, profileName);
  if (!auth) return NextResponse.json({ error: 'Conta/perfil sem token válido.' }, { status: 404 });

  const bmRes = await pool.query(
    `SELECT bm_id FROM meta_ad_accounts WHERE account_id = $1 LIMIT 1`,
    [accountId]
  );
  const bmId: string | null = bmRes.rows[0]?.bm_id ?? null;
  if (!bmId || bmId === 'Personal') {
    return NextResponse.json({ catalogs: [], bm_id: bmId });
  }

  try {
    const catalogs = await listCatalogs(bmId, auth.token);
    return NextResponse.json({ catalogs, bm_id: bmId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
