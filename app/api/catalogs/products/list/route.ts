import { NextRequest, NextResponse } from 'next/server';
import { listCatalogProducts, getCatalogProductStats } from '@/lib/meta-product-catalogs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/catalogs/products/list?catalog_id=...&missing_video=1
 * Lista produtos do snapshot local + stats agregadas (total/with_video/etc).
 * Se missing_video=1, filtra apenas os produtos sem vídeo. Ignorados ficam fora.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const catalogId = (searchParams.get('catalog_id') ?? '').trim();
    if (!catalogId) {
      return NextResponse.json({ success: false, error: 'catalog_id obrigatório' }, { status: 400 });
    }
    const missingVideo = searchParams.get('missing_video') === '1';
    const [products, stats] = await Promise.all([
      listCatalogProducts(catalogId, { missingVideo }),
      getCatalogProductStats(catalogId),
    ]);
    return NextResponse.json({ success: true, products, stats });
  } catch (error: any) {
    console.error('GET /api/catalogs/products/list error:', error);
    return NextResponse.json(
      { success: false, error: error?.message ?? String(error) },
      { status: 500 },
    );
  }
}
