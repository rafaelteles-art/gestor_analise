import { NextRequest, NextResponse } from 'next/server';
import { setCatalogVideoSheet, clearCatalogVideoSheet } from '@/lib/meta-catalogs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * PUT /api/catalogs/video-sheet — link/relink a Video Sheet to a Catalog.
 *   Body: { catalog_id, spreadsheet_id, filename, tab? }  (tab defaults to NOMECLATURA ADS)
 * DELETE /api/catalogs/video-sheet?catalog_id=… — unlink.
 * See CONTEXT.md (Video Sheet) and docs/adr/0008.
 */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const catalog_id = (body?.catalog_id ?? '').toString().trim();
    const spreadsheet_id = (body?.spreadsheet_id ?? '').toString().trim();
    const filename = (body?.filename ?? '').toString().trim();
    const tab = (body?.tab ?? '').toString().trim();
    if (!catalog_id) return NextResponse.json({ success: false, error: 'catalog_id obrigatório' }, { status: 400 });
    if (!spreadsheet_id) return NextResponse.json({ success: false, error: 'spreadsheet_id obrigatório' }, { status: 400 });
    await setCatalogVideoSheet({ catalog_id, spreadsheet_id, filename, tab });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('PUT /api/catalogs/video-sheet error:', error);
    return NextResponse.json({ success: false, error: error?.message ?? String(error) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const catalog_id = (req.nextUrl.searchParams.get('catalog_id') ?? '').trim();
    if (!catalog_id) return NextResponse.json({ success: false, error: 'catalog_id obrigatório' }, { status: 400 });
    await clearCatalogVideoSheet(catalog_id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('DELETE /api/catalogs/video-sheet error:', error);
    return NextResponse.json({ success: false, error: error?.message ?? String(error) }, { status: 500 });
  }
}
