import { NextResponse } from 'next/server';
import { uploadImage, uploadVideo } from '@/lib/meta-campaigns';
import { resolveAuth } from '../_helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Vídeo passa por encoding na Meta — polling de thumbnail pode chegar a ~30s.
export const maxDuration = 120;

/**
 * POST /api/campaigns/image
 * multipart/form-data:
 *   - account_id: string
 *   - profile_name?: string
 *   - file: File (imagem OU vídeo)
 *
 * Resposta:
 *   - imagem: { kind: 'image', hash, filename }
 *   - vídeo:  { kind: 'video', video_id, thumbnail_url?, filename }
 *
 * O nome do endpoint é "image" por motivos históricos — hoje aceita os dois
 * tipos. Renomear quebraria callers existentes, então mantemos o path.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const accountId = String(form.get('account_id') ?? '');
  const profileName = String(form.get('profile_name') ?? '') || null;
  const file = form.get('file');

  if (!accountId) return NextResponse.json({ error: 'account_id obrigatório' }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: 'file obrigatório' }, { status: 400 });

  const auth = await resolveAuth(accountId, profileName);
  if (!auth) return NextResponse.json({ error: 'Conta/perfil sem token válido.' }, { status: 404 });

  const mime = file.type || '';
  const isVideo = mime.startsWith('video/');

  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    if (isVideo) {
      const result = await uploadVideo(accountId, auth.token, file.name, buf, mime);
      return NextResponse.json({
        kind: 'video',
        video_id: result.video_id,
        thumbnail_url: result.thumbnail_url,
        filename: file.name,
      });
    }
    const result = await uploadImage(accountId, auth.token, file.name, buf, mime || 'image/jpeg');
    return NextResponse.json({ kind: 'image', hash: result.hash, filename: file.name });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
