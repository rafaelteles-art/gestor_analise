import { NextRequest, NextResponse } from 'next/server';
import { getDriveFileMeta, DriveAuthError } from '@/lib/google-drive';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/google/drive/file/[id]
 * Returns Drive file metadata for builder display.
 * Response: { name: string; mimeType: string; size: number }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: fileId } = await params;
  if (!fileId) {
    return NextResponse.json({ error: 'id obrigatório' }, { status: 400 });
  }

  try {
    const meta = await getDriveFileMeta(fileId);
    return NextResponse.json(meta);
  } catch (err: any) {
    if (err instanceof DriveAuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error(`GET /api/google/drive/file/${fileId} error:`, err);
    return NextResponse.json({ error: err.message ?? 'Erro desconhecido' }, { status: 500 });
  }
}
