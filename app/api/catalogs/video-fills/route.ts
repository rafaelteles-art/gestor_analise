import { NextRequest, NextResponse } from 'next/server';
import {
  armCatalogVideoFill,
  listVideoFills,
  cancelVideoFill,
} from '@/lib/catalog-video-fills';
import { auth } from '@/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * Scheduled Video Fill — arm/list/cancel (docs/adr/0008).
 * POST   { catalog_id }   → agenda um fill para as próximas 08:30 GMT-3.
 * GET    ?catalog_id=...  → lista fills do catálogo (mais recente no topo).
 * DELETE ?id=...          → cancela um fill ainda pendente.
 */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const catalogId = (body?.catalog_id ?? '').toString().trim();
    if (!catalogId) return NextResponse.json({ success: false, error: 'catalog_id obrigatório' }, { status: 400 });

    // armed_by best-effort: se a auth não resolver, agenda sem o carimbo.
    let armedBy: string | null = null;
    try {
      const session = await auth();
      armedBy = session?.user?.email ?? null;
    } catch {
      armedBy = null;
    }

    const { armed, fill } = await armCatalogVideoFill(catalogId, armedBy);
    return NextResponse.json({ success: true, armed, fill });
  } catch (error: any) {
    console.error('POST /api/catalogs/video-fills error:', error);
    return NextResponse.json({ success: false, error: error?.message ?? String(error) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const catalogId = new URL(req.url).searchParams.get('catalog_id');
    if (!catalogId) return NextResponse.json({ success: false, error: 'catalog_id obrigatório' }, { status: 400 });
    const fills = await listVideoFills(catalogId);
    return NextResponse.json({ success: true, fills });
  } catch (error: any) {
    console.error('GET /api/catalogs/video-fills error:', error);
    return NextResponse.json({ success: false, error: error?.message ?? String(error) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const idRaw = searchParams.get('id') ?? '';
    const id = Number(idRaw);
    if (!Number.isFinite(id)) return NextResponse.json({ success: false, error: 'id inválido' }, { status: 400 });
    const { canceled } = await cancelVideoFill(id);
    return NextResponse.json({ success: true, canceled });
  } catch (error: any) {
    console.error('DELETE /api/catalogs/video-fills error:', error);
    return NextResponse.json({ success: false, error: error?.message ?? String(error) }, { status: 500 });
  }
}
