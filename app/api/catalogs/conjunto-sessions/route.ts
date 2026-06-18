import { NextRequest, NextResponse } from 'next/server';
import {
  listConjuntoSessions,
  upsertConjuntoSession,
  deleteConjuntoSession,
} from '@/lib/meta-product-catalogs';
import type { ConjuntoSessionItem } from '@/lib/conjunto-sessions';
import { auth } from '@/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Histórico de sessões de criação de conjuntos, por catálogo.
 * GET    ?catalog_id=...                → sessões do catálogo (mais recente no topo)
 * POST   { session_id, catalog_id, bm_id?, items[] } → upsert (idempotente)
 * DELETE ?id=... | ?session_id=...      → remove uma sessão
 */

function sanitizeItems(raw: unknown): { ok: true; items: ConjuntoSessionItem[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'items (array) obrigatório' };
  const items: ConjuntoSessionItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') return { ok: false, error: 'item inválido' };
    const it = r as Record<string, unknown>;
    if (typeof it.product_set_id !== 'string' || it.product_set_id.trim() === '') {
      return { ok: false, error: 'item sem product_set_id' };
    }
    items.push({
      orderIndex: Number(it.orderIndex ?? 0),
      product_set_id: String(it.product_set_id),
      retailer_id: String(it.retailer_id ?? ''),
      product_id: String(it.product_id ?? ''),
      product_name: String(it.product_name ?? ''),
      ad_name: String(it.ad_name ?? ''),
    });
  }
  return { ok: true, items };
}

export async function GET(req: NextRequest) {
  try {
    const catalogId = new URL(req.url).searchParams.get('catalog_id');
    if (!catalogId) return NextResponse.json({ success: false, error: 'catalog_id obrigatório' }, { status: 400 });
    const sessions = await listConjuntoSessions(catalogId);
    return NextResponse.json({ success: true, sessions });
  } catch (error: any) {
    console.error('GET /api/catalogs/conjunto-sessions error:', error);
    return NextResponse.json({ success: false, error: error?.message ?? String(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const session_id = (body?.session_id ?? '').toString().trim();
    const catalog_id = (body?.catalog_id ?? '').toString().trim();
    if (!session_id) return NextResponse.json({ success: false, error: 'session_id obrigatório' }, { status: 400 });
    if (!catalog_id) return NextResponse.json({ success: false, error: 'catalog_id obrigatório' }, { status: 400 });

    const validated = sanitizeItems(body?.items);
    if (!validated.ok) return NextResponse.json({ success: false, error: validated.error }, { status: 400 });
    if (validated.items.length === 0) {
      return NextResponse.json({ success: false, error: 'sessão sem itens — nada a salvar' }, { status: 400 });
    }

    // created_by best-effort: se a auth não resolver, salva sem o carimbo.
    let created_by: string | null = null;
    try {
      const session = await auth();
      created_by = session?.user?.email ?? null;
    } catch {
      created_by = null;
    }

    const saved = await upsertConjuntoSession({
      session_id,
      catalog_id,
      bm_id: body?.bm_id ? String(body.bm_id) : null,
      created_by,
      items: validated.items,
    });
    return NextResponse.json({ success: true, session: saved });
  } catch (error: any) {
    console.error('POST /api/catalogs/conjunto-sessions error:', error);
    return NextResponse.json({ success: false, error: error?.message ?? String(error) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const idParam = searchParams.get('id');
    const sessionId = searchParams.get('session_id');
    if (!idParam && !sessionId) {
      return NextResponse.json({ success: false, error: 'id ou session_id obrigatório' }, { status: 400 });
    }
    await deleteConjuntoSession({
      id: idParam ? Number(idParam) : undefined,
      session_id: sessionId ?? undefined,
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('DELETE /api/catalogs/conjunto-sessions error:', error);
    return NextResponse.json({ success: false, error: error?.message ?? String(error) }, { status: 500 });
  }
}
