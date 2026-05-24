import { NextResponse } from 'next/server';
import { listBusinessManagers } from '@/lib/meta-campaigns';
import { pool } from '@/lib/db';
import { resolveAuth } from '../_helpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/campaigns/businesses?account_id=act_xxx&profile_name=Foo
 *
 * Une duas fontes de BMs:
 *   1. Graph API (via token resolvido para esse account/profile) — descoberta
 *      em tempo real. Captura BMs novos / não sincronizados.
 *   2. Banco (meta_ad_accounts.bm_id/bm_name onde accessible_profiles inclui
 *      profile_name) — funciona mesmo quando o token de System User não
 *      responde a /me/businesses nem expõe o BM-mãe em /me?fields=business.
 *
 * Retorna `{ businesses, source_counts }` com diagnóstico das fontes.
 */
export async function GET(req: Request) {
  try {
    return await handle(req);
  } catch (err: unknown) {
    console.error('[api/campaigns/businesses] unexpected error:', err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function handle(req: Request) {
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get('account_id');
  const profileName = searchParams.get('profile_name');
  if (!accountId) return NextResponse.json({ error: 'account_id obrigatório' }, { status: 400 });

  const auth = await resolveAuth(accountId, profileName);
  if (!auth) return NextResponse.json({ error: 'Conta/perfil sem token válido.' }, { status: 404 });

  const map = new Map<string, { id: string; name: string; source: string }>();
  let apiCount = 0;
  let apiError: string | null = null;

  // Fonte 1: Graph API
  try {
    const fromApi = await listBusinessManagers(auth.token);
    apiCount = fromApi.length;
    for (const bm of fromApi) {
      if (!map.has(bm.id)) map.set(bm.id, { id: bm.id, name: bm.name, source: 'api' });
    }
  } catch (err: unknown) {
    apiError = err instanceof Error ? err.message : String(err);
  }

  // Fonte 2: Banco — bm_id/bm_name das contas já sincronizadas para esse perfil.
  // `accessible_profiles` é TEXT[] (postgres array) — usa ANY().
  let dbCount = 0;
  if (profileName) {
    try {
      const { rows } = await pool.query(
        `SELECT DISTINCT bm_id, bm_name
           FROM meta_ad_accounts
          WHERE bm_id IS NOT NULL
            AND bm_id <> 'Personal'
            AND $1 = ANY(accessible_profiles)`,
        [profileName],
      );
      dbCount = rows.length;
      for (const r of rows) {
        if (!map.has(r.bm_id)) {
          map.set(r.bm_id, { id: r.bm_id, name: r.bm_name ?? r.bm_id, source: 'db' });
        }
      }
    } catch (err: unknown) {
      // Loga mas não derruba — se o filtro por perfil falhar, o fallback da
      // própria conta abaixo ainda funciona.
      console.warn('[api/campaigns/businesses] DB lookup falhou:', err);
    }
  }

  // Fonte 3: BM da própria conta (fallback final, caso nem API nem perfil tenha pego)
  const bmRes = await pool.query(
    `SELECT bm_id, bm_name FROM meta_ad_accounts WHERE account_id = $1 LIMIT 1`,
    [accountId],
  );
  const ownBmId = bmRes.rows[0]?.bm_id;
  const ownBmName = bmRes.rows[0]?.bm_name;
  if (ownBmId && ownBmId !== 'Personal' && !map.has(ownBmId)) {
    map.set(ownBmId, { id: ownBmId, name: ownBmName ?? ownBmId, source: 'account' });
  }

  const businesses = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({
    businesses,
    source_counts: { api: apiCount, db: dbCount, total: businesses.length },
    api_error: apiError,
  });
}
