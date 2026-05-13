import { NextResponse } from 'next/server';
import { listPages } from '@/lib/meta-campaigns';
import { pool } from '@/lib/db';
import { resolveAuth } from '../_helpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/campaigns/pages?profile_name=Foo[&account_id=act_xxx]
 *
 * Páginas são por perfil/BM (não por conta). Varremos todos os BMs aos quais
 * o perfil tem acesso (via `accessible_profiles` em meta_ad_accounts) e
 * unimos as páginas. Aceita `account_id` apenas como fallback de auth quando
 * o perfil é desconhecido.
 *
 * Tokens System User não veem páginas em `me/accounts` — `listPages(token, bm_id)`
 * varre `{bm}/owned_pages` + `{bm}/client_pages` (memória meta_system_user_pages).
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const profileName = searchParams.get('profile_name');
  const accountId = searchParams.get('account_id');
  if (!profileName && !accountId) {
    return NextResponse.json({ error: 'profile_name ou account_id obrigatório' }, { status: 400 });
  }

  const auth = await resolveAuth(accountId ?? '', profileName);
  if (!auth) return NextResponse.json({ error: 'Conta/perfil sem token válido.' }, { status: 404 });

  // BMs acessíveis ao perfil. Sem perfil, cai no bm da conta (modo legado).
  let bmIds: string[] = [];
  if (profileName) {
    const bmRes = await pool.query(
      `SELECT DISTINCT bm_id FROM meta_ad_accounts
        WHERE access_token IS NOT NULL
          AND $1 = ANY(COALESCE(accessible_profiles, ARRAY[]::TEXT[]))
          AND bm_id IS NOT NULL`,
      [profileName]
    );
    bmIds = bmRes.rows.map((r) => r.bm_id as string);
  } else if (accountId) {
    const bmRes = await pool.query(
      `SELECT bm_id FROM meta_ad_accounts WHERE account_id = $1 LIMIT 1`,
      [accountId]
    );
    if (bmRes.rows[0]?.bm_id) bmIds = [bmRes.rows[0].bm_id];
  }

  // Sem nenhum BM associado, tenta `me/accounts` (caso token pessoal).
  if (bmIds.length === 0) bmIds = ['Personal'];

  try {
    const byId = new Map<string, { id: string; name: string; instagram_business_account?: { id: string } }>();
    // Sequencial pra evitar rate-limit (#4); cache em memória da lib amortiza
    // entre chamadas próximas no tempo.
    for (const bmId of bmIds) {
      const pages = await listPages(auth.token, bmId);
      for (const p of pages) {
        if (!byId.has(p.id)) byId.set(p.id, p);
        else if (!byId.get(p.id)!.instagram_business_account && p.instagram_business_account) {
          byId.get(p.id)!.instagram_business_account = p.instagram_business_account;
        }
      }
    }
    const pages = Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ pages, bm_ids: bmIds });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
