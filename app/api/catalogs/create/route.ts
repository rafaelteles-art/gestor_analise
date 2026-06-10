import { NextRequest, NextResponse } from 'next/server';
import { createMetaCatalog } from '@/lib/meta-catalogs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/catalogs/create
 * Body: { bm_id, name }
 * Cria um catálogo `commerce` no BM e espelha a linha em meta_catalogs.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const bmId = (body?.bm_id ?? '').toString().trim();
    const name = (body?.name ?? '').toString().trim();

    if (!bmId) return NextResponse.json({ success: false, error: 'bm_id obrigatório' }, { status: 400 });
    if (!name) return NextResponse.json({ success: false, error: 'name obrigatório' }, { status: 400 });

    const result = await createMetaCatalog(bmId, name);
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    const status = error?.code === 'NO_TOKEN' ? 403 : error?.code === 'INVALID_INPUT' ? 400 : 500;
    console.error('POST /api/catalogs/create error:', error);
    return NextResponse.json(
      { success: false, error: error?.message ?? String(error), meta_code: error?.code ?? null },
      { status }
    );
  }
}
