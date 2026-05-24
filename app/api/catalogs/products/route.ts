import { NextRequest, NextResponse } from 'next/server';
import { createProductWithSet, type ProductPresetConfig } from '@/lib/meta-product-catalogs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const VALID_AVAILABILITY = new Set(['in stock', 'out of stock', 'preorder', 'available for order', 'discontinued']);
const VALID_CONDITION = new Set(['new', 'refurbished', 'used']);

function validatePreset(raw: any): { ok: true; cfg: ProductPresetConfig } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'preset (objeto) obrigatório' };
  const required = ['description', 'link', 'image_url', 'price', 'currency', 'brand', 'availability', 'condition'] as const;
  for (const k of required) {
    if (typeof raw[k] !== 'string' || raw[k].trim() === '') {
      return { ok: false, error: `preset.${k} obrigatório (string não-vazia)` };
    }
  }
  if (!VALID_AVAILABILITY.has(raw.availability)) return { ok: false, error: `availability inválido` };
  if (!VALID_CONDITION.has(raw.condition)) return { ok: false, error: `condition inválido` };
  return {
    ok: true,
    cfg: {
      description: String(raw.description),
      link: String(raw.link),
      image_url: String(raw.image_url),
      price: String(raw.price),
      currency: String(raw.currency).toUpperCase(),
      brand: String(raw.brand),
      availability: raw.availability,
      condition: raw.condition,
    },
  };
}

/**
 * POST /api/catalogs/products
 * Body: { catalog_id, bm_id, ad_name, preset: ProductPresetConfig }
 * Cria produto + product set (filtro retailer_id == retailer_id do produto).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const catalogId = (body?.catalog_id ?? '').toString().trim();
    const bmId = (body?.bm_id ?? '').toString().trim();
    const adName = (body?.ad_name ?? '').toString().trim();
    const productName = (body?.product_name ?? '').toString().trim();

    if (!catalogId) return NextResponse.json({ success: false, error: 'catalog_id obrigatório' }, { status: 400 });
    if (!bmId) return NextResponse.json({ success: false, error: 'bm_id obrigatório' }, { status: 400 });
    if (!adName) return NextResponse.json({ success: false, error: 'ad_name obrigatório' }, { status: 400 });
    if (!productName) return NextResponse.json({ success: false, error: 'product_name obrigatório' }, { status: 400 });

    const validated = validatePreset(body?.preset);
    if (!validated.ok) return NextResponse.json({ success: false, error: validated.error }, { status: 400 });

    const result = await createProductWithSet({
      catalogId,
      bmId,
      adName,
      productName,
      preset: validated.cfg,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    const status = error?.code === 'NO_TOKEN' ? 403 : 500;
    console.error('POST /api/catalogs/products error:', error);
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
