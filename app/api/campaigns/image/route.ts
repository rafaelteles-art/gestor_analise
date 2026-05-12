import { NextResponse } from 'next/server';
import { uploadImage } from '@/lib/meta-campaigns';
import { resolveAuth } from '../_helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/campaigns/image
 * multipart/form-data:
 *   - account_id: string
 *   - profile_name?: string
 *   - file: File
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

  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const result = await uploadImage(accountId, auth.token, file.name, buf, file.type || 'image/jpeg');
    return NextResponse.json({ hash: result.hash, filename: file.name });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
