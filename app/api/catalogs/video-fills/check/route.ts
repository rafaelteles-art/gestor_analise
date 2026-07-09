import { NextRequest, NextResponse } from 'next/server';
import { getCatalogVideoSheet } from '@/lib/meta-catalogs';
import { resolveVideoFillPlan } from '@/lib/catalog-video-import-run';
import { linkCheckSummary } from '@/lib/catalog-video-import';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60; // leitura real do Google Sheets — pode levar segundos

/**
 * GET /api/catalogs/video-fills/check?catalog_id=…
 *
 * Checagem de links do builder (docs/adr/0010): dry-run do fill — lê a planilha
 * vinculada AGORA (mesma cascata de detecção do import, sem escrever nada) e
 * responde quantos produtos sem vídeo já têm link ("42 de 50"). Informa a escolha
 * do hora+N; nunca bloqueia o submit. On-demand por design: cada chamada paga uma
 * leitura de Sheets, então o builder só chama no clique do botão.
 */
export async function GET(req: NextRequest) {
  try {
    const catalogId = (req.nextUrl.searchParams.get('catalog_id') ?? '').trim();
    if (!catalogId) return NextResponse.json({ success: false, error: 'catalog_id obrigatório' }, { status: 400 });

    const sheet = await getCatalogVideoSheet(catalogId);
    if (!sheet) {
      return NextResponse.json(
        { success: false, error: 'Catálogo sem planilha vinculada — vincule uma planilha em /catalogo.' },
        { status: 400 },
      );
    }

    const resolved = await resolveVideoFillPlan(catalogId, sheet.spreadsheet_id, sheet.tab);
    if (!resolved.ok) {
      return NextResponse.json({ success: false, error: resolved.errors.join(' ') }, { status: 422 });
    }

    return NextResponse.json({ success: true, ...linkCheckSummary(resolved.plan) });
  } catch (error: any) {
    console.error('GET /api/catalogs/video-fills/check error:', error);
    return NextResponse.json({ success: false, error: error?.message ?? String(error) }, { status: 500 });
  }
}
