import { NextRequest, NextResponse } from 'next/server';
import { updateProductVideo } from '@/lib/meta-product-catalogs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * PATCH /api/catalogs/products/video
 * Body: { catalog_id, product_id, video_url }
 * Atualiza o campo video[] do produto na Meta + refresca o snapshot local.
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const catalogId = (body?.catalog_id ?? '').toString().trim();
    const productId = (body?.product_id ?? '').toString().trim();
    const videoUrl = (body?.video_url ?? '').toString().trim();

    if (!catalogId) return NextResponse.json({ success: false, error: 'catalog_id obrigatório' }, { status: 400 });
    if (!productId) return NextResponse.json({ success: false, error: 'product_id obrigatório' }, { status: 400 });
    if (!videoUrl)  return NextResponse.json({ success: false, error: 'video_url obrigatório' }, { status: 400 });

    const result = await updateProductVideo(catalogId, productId, videoUrl);
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    const status = error?.code === 'NO_TOKEN' ? 403
                 : error?.code === 'INVALID_INPUT' || error?.code === 'INVALID_URL' ? 400
                 : 500;
    console.error('PATCH /api/catalogs/products/video error:', error);
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
