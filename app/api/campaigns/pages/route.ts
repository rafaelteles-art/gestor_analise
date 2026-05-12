import { NextResponse } from 'next/server';
import { listPages } from '@/lib/meta-campaigns';
import { resolveAuth } from '../_helpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/campaigns/pages?account_id=act_xxx&profile_name=Foo
 * Lista as Páginas do Facebook administradas pelo dono do token.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get('account_id');
  const profileName = searchParams.get('profile_name');
  if (!accountId) return NextResponse.json({ error: 'account_id obrigatório' }, { status: 400 });

  const auth = await resolveAuth(accountId, profileName);
  if (!auth) return NextResponse.json({ error: 'Conta/perfil sem token válido.' }, { status: 404 });

  try {
    const pages = await listPages(auth.token);
    return NextResponse.json({ pages });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
