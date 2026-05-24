import { NextRequest, NextResponse } from 'next/server';
import { syncCatalogProducts } from '@/lib/meta-product-catalogs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * POST /api/catalogs/products/sync
 * Body: { catalog_id }
 * Pagina todos os produtos do catálogo na Meta e atualiza o snapshot local.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const catalogId = (body?.catalog_id ?? '').toString().trim();
    if (!catalogId) {
      return NextResponse.json({ success: false, error: 'catalog_id obrigatório' }, { status: 400 });
    }
    const result = await syncCatalogProducts(catalogId);
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    const status = error?.code === 'NO_TOKEN' ? 403 : 500;
    console.error('POST /api/catalogs/products/sync error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message ?? String(error),
        step: error?.step ?? null,
        meta_code: error?.code ?? null,
      },
      { status },
    );
  }
}
