import { NextRequest, NextResponse } from 'next/server';
import {
  listIgnoredProducts,
  ignoreProduct,
  unignoreProduct,
} from '@/lib/meta-product-catalogs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/catalogs/products/ignored?catalog_id=...
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const catalogId = (searchParams.get('catalog_id') ?? '').trim();
    if (!catalogId) {
      return NextResponse.json({ success: false, error: 'catalog_id obrigatório' }, { status: 400 });
    }
    const items = await listIgnoredProducts(catalogId);
    return NextResponse.json({ success: true, items });
  } catch (error: any) {
    console.error('GET /api/catalogs/products/ignored error:', error);
    return NextResponse.json({ success: false, error: error?.message ?? String(error) }, { status: 500 });
  }
}

/**
 * POST /api/catalogs/products/ignored
 * Body: { catalog_id, product_id, retailer_id?, name? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const catalogId = (body?.catalog_id ?? '').toString().trim();
    const productId = (body?.product_id ?? '').toString().trim();
    const retailerId = body?.retailer_id == null ? null : String(body.retailer_id);
    const name = body?.name == null ? null : String(body.name);

    if (!catalogId) return NextResponse.json({ success: false, error: 'catalog_id obrigatório' }, { status: 400 });
    if (!productId) return NextResponse.json({ success: false, error: 'product_id obrigatório' }, { status: 400 });

    await ignoreProduct(catalogId, productId, { retailerId, name });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('POST /api/catalogs/products/ignored error:', error);
    return NextResponse.json({ success: false, error: error?.message ?? String(error) }, { status: 500 });
  }
}

/**
 * DELETE /api/catalogs/products/ignored?catalog_id=...&product_id=...
 */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const catalogId = (searchParams.get('catalog_id') ?? '').trim();
    const productId = (searchParams.get('product_id') ?? '').trim();
    if (!catalogId) return NextResponse.json({ success: false, error: 'catalog_id obrigatório' }, { status: 400 });
    if (!productId) return NextResponse.json({ success: false, error: 'product_id obrigatório' }, { status: 400 });

    await unignoreProduct(catalogId, productId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('DELETE /api/catalogs/products/ignored error:', error);
    return NextResponse.json({ success: false, error: error?.message ?? String(error) }, { status: 500 });
  }
}
