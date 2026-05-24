import { NextRequest, NextResponse } from 'next/server';
import {
  listPresets,
  upsertPreset,
  deletePreset,
  type ProductPresetConfig,
} from '@/lib/meta-product-catalogs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VALID_AVAILABILITY = new Set(['in stock', 'out of stock', 'preorder', 'available for order', 'discontinued']);
const VALID_CONDITION = new Set(['new', 'refurbished', 'used']);

function validateConfig(raw: any): { ok: true; cfg: ProductPresetConfig } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'config (objeto) obrigatório' };
  const required = ['description', 'link', 'image_url', 'price', 'currency', 'brand', 'availability', 'condition'] as const;
  for (const k of required) {
    if (typeof raw[k] !== 'string' || raw[k].trim() === '') {
      return { ok: false, error: `Campo "${k}" obrigatório (string não-vazia)` };
    }
  }
  if (!VALID_AVAILABILITY.has(raw.availability)) {
    return { ok: false, error: `availability inválido. Valores: ${[...VALID_AVAILABILITY].join(', ')}` };
  }
  if (!VALID_CONDITION.has(raw.condition)) {
    return { ok: false, error: `condition inválido. Valores: ${[...VALID_CONDITION].join(', ')}` };
  }
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

export async function GET() {
  try {
    const presets = await listPresets();
    return NextResponse.json({ success: true, presets });
  } catch (error: any) {
    console.error('GET /api/catalogs/product-presets error:', error);
    return NextResponse.json({ success: false, error: error?.message ?? String(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const name = (body?.name ?? '').toString().trim();
    if (!name) return NextResponse.json({ success: false, error: 'name obrigatório' }, { status: 400 });

    const validated = validateConfig(body?.config);
    if (!validated.ok) return NextResponse.json({ success: false, error: validated.error }, { status: 400 });

    const preset = await upsertPreset(name, validated.cfg);
    return NextResponse.json({ success: true, preset });
  } catch (error: any) {
    console.error('POST /api/catalogs/product-presets error:', error);
    return NextResponse.json({ success: false, error: error?.message ?? String(error) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const idParam = searchParams.get('id');
    const name = searchParams.get('name');
    if (!idParam && !name) {
      return NextResponse.json({ success: false, error: 'id ou name obrigatório' }, { status: 400 });
    }
    await deletePreset({ id: idParam ? Number(idParam) : undefined, name: name ?? undefined });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('DELETE /api/catalogs/product-presets error:', error);
    return NextResponse.json({ success: false, error: error?.message ?? String(error) }, { status: 500 });
  }
}
