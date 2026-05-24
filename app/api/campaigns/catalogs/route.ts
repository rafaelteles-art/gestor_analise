import { NextResponse } from 'next/server';
import { createCatalog, listCatalogs } from '@/lib/meta-campaigns';
import { pool } from '@/lib/db';
import { resolveAuth } from '../_helpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/campaigns/catalogs?account_id=act_xxx&profile_name=Foo
 *
 * Une duas fontes de catálogos:
 *   1. Tabela `meta_catalogs` filtrada por accessible_profiles (sync prévio
 *      via /catalogo). Cobre owned + client + Partner-shared.
 *   2. Graph API live em `{bm_id_da_conta}/owned_product_catalogs`. Captura
 *      catálogos novos que ainda não foram sincronizados.
 *
 * Retorna `{ catalogs, source_counts: { db, api, total }, bm_id }`.
 */
export async function GET(req: Request) {
  try {
    return await handleGet(req);
  } catch (err: unknown) {
    console.error('[api/campaigns/catalogs] unexpected error:', err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function handleGet(req: Request) {
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get('account_id');
  const profileName = searchParams.get('profile_name');
  if (!accountId) return NextResponse.json({ error: 'account_id obrigatório' }, { status: 400 });

  const auth = await resolveAuth(accountId, profileName);
  if (!auth) return NextResponse.json({ error: 'Conta/perfil sem token válido.' }, { status: 404 });

  type Catalog = { id: string; name: string; product_count?: number; vertical?: string; bm_id?: string; bm_name?: string };
  const map = new Map<string, Catalog & { source: string }>();

  // Fonte 1: meta_catalogs sincronizado — TODOS os catálogos sincronizados,
  // independente de profile_name ou bm_id. A premissa: o usuário troca de
  // conta livremente e quer ver tudo que existe; a Meta valida na submissão
  // se a conta tem permissão pra usar o catálogo escolhido.
  let dbCount = 0;
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (catalog_id)
              catalog_id, catalog_name, product_count, vertical, bm_id, bm_name
         FROM meta_catalogs
        ORDER BY catalog_id, relationship ASC`,
    );
    dbCount = rows.length;
    for (const r of rows) {
      if (!map.has(r.catalog_id)) {
        map.set(r.catalog_id, {
          id: r.catalog_id,
          name: r.catalog_name,
          product_count: r.product_count ?? undefined,
          vertical: r.vertical ?? undefined,
          bm_id: r.bm_id ?? undefined,
          bm_name: r.bm_name ?? undefined,
          source: 'db',
        });
      }
    }
  } catch (err: unknown) {
    console.warn('[api/campaigns/catalogs] DB lookup falhou:', err);
  }
  // profileName não é mais usado para filtrar, mas mantido na assinatura caso
  // a UI ainda envie (compatível com chamadas existentes).
  void profileName;

  // Fonte 2: Graph API live no BM da conta
  const bmRes = await pool.query(
    `SELECT bm_id FROM meta_ad_accounts WHERE account_id = $1 LIMIT 1`,
    [accountId]
  );
  const bmId: string | null = bmRes.rows[0]?.bm_id ?? null;
  let apiCount = 0;
  let apiError: string | null = null;
  if (bmId && bmId !== 'Personal') {
    try {
      const fromApi = await listCatalogs(bmId, auth.token);
      apiCount = fromApi.length;
      for (const c of fromApi) {
        if (!map.has(c.id)) {
          map.set(c.id, { ...c, source: 'api' });
        }
      }
    } catch (err: unknown) {
      apiError = err instanceof Error ? err.message : String(err);
    }
  }

  const catalogs = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({
    catalogs,
    bm_id: bmId,
    source_counts: { db: dbCount, api: apiCount, total: catalogs.length },
    api_error: apiError,
  });
}

/**
 * POST /api/campaigns/catalogs
 * Body: { account_id, profile_name?, name, vertical?, bm_id? }
 *
 * Cria um catálogo novo. Se `bm_id` for enviado explicitamente, usa esse BM;
 * caso contrário cai no BM da conta de anúncios (meta_ad_accounts.bm_id).
 *
 * Retorna o catálogo criado (id, name, vertical) pra ser usado imediatamente
 * no fluxo de campanha.
 */
export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const { account_id, profile_name, name, vertical, bm_id: bmIdExplicit } = body ?? {};

  if (!account_id) return NextResponse.json({ error: 'account_id obrigatório' }, { status: 400 });
  if (!name || typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'name do catálogo obrigatório' }, { status: 400 });
  }

  const auth = await resolveAuth(account_id, profile_name);
  if (!auth) return NextResponse.json({ error: 'Conta/perfil sem token válido.' }, { status: 404 });

  let bmId: string | null = typeof bmIdExplicit === 'string' && bmIdExplicit.trim() ? bmIdExplicit.trim() : null;
  if (!bmId) {
    const bmRes = await pool.query(
      `SELECT bm_id FROM meta_ad_accounts WHERE account_id = $1 LIMIT 1`,
      [account_id]
    );
    bmId = bmRes.rows[0]?.bm_id ?? null;
  }
  if (!bmId || bmId === 'Personal') {
    return NextResponse.json(
      { error: 'Selecione um Business Manager para criar o catálogo.' },
      { status: 400 }
    );
  }

  try {
    const catalog = await createCatalog(bmId, name.trim(), auth.token, vertical || 'commerce');
    return NextResponse.json({ catalog, bm_id: bmId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
