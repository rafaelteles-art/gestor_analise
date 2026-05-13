import { NextResponse } from 'next/server';
import { listProductSets } from '@/lib/meta-campaigns';
import { resolveAuth } from '../_helpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/campaigns/product_sets?account_id=act_xxx&profile_name=Foo&catalog_id=123
 * Lista conjuntos de produtos dentro de um catálogo.
 * Conta + perfil servem só pra resolver o token; o catalog_id é a chave real.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get('account_id');
  const profileName = searchParams.get('profile_name');
  const catalogId = searchParams.get('catalog_id');
  if (!accountId) return NextResponse.json({ error: 'account_id obrigatório' }, { status: 400 });
  if (!catalogId) return NextResponse.json({ error: 'catalog_id obrigatório' }, { status: 400 });

  const auth = await resolveAuth(accountId, profileName);
  if (!auth) return NextResponse.json({ error: 'Conta/perfil sem token válido.' }, { status: 404 });

  try {
    const product_sets = await listProductSets(catalogId, auth.token);
    return NextResponse.json({ product_sets });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
