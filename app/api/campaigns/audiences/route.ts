import { NextResponse } from 'next/server';
import { listCustomAudiences, listSavedAudiences } from '@/lib/meta-campaigns';
import { resolveAuth } from '../_helpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/campaigns/audiences?account_id=act_xxx&profile_name=Foo
 * Retorna { custom: [...], saved: [...] }.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get('account_id');
  const profileName = searchParams.get('profile_name');
  if (!accountId) return NextResponse.json({ error: 'account_id obrigatório' }, { status: 400 });

  const auth = await resolveAuth(accountId, profileName);
  if (!auth) return NextResponse.json({ error: 'Conta/perfil sem token válido.' }, { status: 404 });

  try {
    const [custom, saved] = await Promise.all([
      listCustomAudiences(accountId, auth.token),
      listSavedAudiences(accountId, auth.token).catch(() => []),
    ]);
    return NextResponse.json({ custom, saved });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
