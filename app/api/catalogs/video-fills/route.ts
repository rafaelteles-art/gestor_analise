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
 * Scheduled Video Fill — arm/list/cancel (docs/adr/0008 + 0010).
 * POST   { catalog_id, hours_from_now? } → agenda um fill: sem hours_from_now,
 *        para as próximas 08:30 GMT-3 (âncora); com inteiro 0–24, para criação
 *        + N horas (0 = próximo tick do poller). Resposta inclui `reanchored`
 *        quando o arm moveu o pendente do dia para um horário mais cedo.
 * GET    ?catalog_id=...  → lista fills do catálogo (mais recente no topo).
 * DELETE ?id=...          → cancela um fill ainda pendente.
 */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const catalogId = (body?.catalog_id ?? '').toString().trim();
    if (!catalogId) return NextResponse.json({ success: false, error: 'catalog_id obrigatório' }, { status: 400 });

    let hoursFromNow: number | null = null;
    const rawHours = body?.hours_from_now;
    if (rawHours !== undefined && rawHours !== null && rawHours !== '') {
      const n = Number(rawHours);
      if (!Number.isInteger(n) || n < 0 || n > 24) {
        return NextResponse.json(
          { success: false, error: 'hours_from_now deve ser um inteiro entre 0 e 24' },
          { status: 400 },
        );
      }
      hoursFromNow = n;
    }

    // armed_by best-effort: se a auth não resolver, agenda sem o carimbo.
    let armedBy: string | null = null;
    try {
      const session = await auth();
      armedBy = session?.user?.email ?? null;
    } catch {
      armedBy = null;
    }

    const { armed, reanchored, fill } = await armCatalogVideoFill(catalogId, armedBy, hoursFromNow);
    return NextResponse.json({ success: true, armed, reanchored, fill });
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
