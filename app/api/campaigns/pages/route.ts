import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/campaigns/pages?profile_name=Foo
 *
 * Serve EXCLUSIVAMENTE de `meta_pages` (populado por /api/pages/sync).
 * Nunca bate na Graph aqui — abrir o dropdown de páginas é uma operação
 * idempotente, não vale o custo de (#4) Application request limit reached.
 *
 * Se um perfil novo ainda não tem páginas no banco, rode /api/pages/sync
 * (ou clique "Sincronizar Páginas" em /paginas).
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const profileName = searchParams.get('profile_name');
  if (!profileName) {
    return NextResponse.json({ error: 'profile_name obrigatório' }, { status: 400 });
  }

  try {
    // Garante schema (tabela + coluna IG) — idempotente.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS meta_pages (
        page_id              TEXT PRIMARY KEY,
        page_name            TEXT NOT NULL,
        ad_limit             INTEGER,
        ads_running          INTEGER NOT NULL DEFAULT 0,
        accessible_profiles  TEXT[]  NOT NULL DEFAULT '{}',
        ig_account_id        TEXT,
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`ALTER TABLE meta_pages ADD COLUMN IF NOT EXISTS ig_account_id TEXT`);

    const dbRes = await pool.query(
      `SELECT page_id, page_name, ig_account_id, ad_limit, ads_running
         FROM meta_pages
        WHERE $1 = ANY(COALESCE(accessible_profiles, ARRAY[]::TEXT[]))
        ORDER BY page_name ASC`,
      [profileName]
    );

    const pages = dbRes.rows.map((r) => ({
      id: r.page_id as string,
      name: (r.page_name as string) ?? r.page_id,
      instagram_business_account: r.ig_account_id
        ? { id: r.ig_account_id as string }
        : undefined,
      ad_limit: r.ad_limit === null || r.ad_limit === undefined ? null : Number(r.ad_limit),
      ads_running: Number(r.ads_running ?? 0),
    }));

    return NextResponse.json({
      pages,
      source: 'db',
      hint: pages.length === 0
        ? `Nenhuma página em meta_pages para o perfil ${profileName}. Rode /api/pages/sync.`
        : undefined,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
