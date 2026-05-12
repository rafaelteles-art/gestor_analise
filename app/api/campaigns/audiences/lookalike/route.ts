import { NextResponse } from 'next/server';
import { createLookalike } from '@/lib/meta-campaigns';
import { resolveAuth } from '../../_helpers';

export const dynamic = 'force-dynamic';

/**
 * POST /api/campaigns/audiences/lookalike
 * Body: {
 *   account_id, profile_name?,
 *   name, origin_audience_id,
 *   ratio (0.01..0.20), country (ex: 'BR'),
 *   type?: 'similarity' | 'reach'
 * }
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { account_id, profile_name, name, origin_audience_id, ratio, country, type } = body;

  if (!account_id || !name || !origin_audience_id || !ratio || !country) {
    return NextResponse.json({ error: 'Campos obrigatórios: account_id, name, origin_audience_id, ratio, country.' }, { status: 400 });
  }
  const r = Number(ratio);
  if (!Number.isFinite(r) || r < 0.01 || r > 0.2) {
    return NextResponse.json({ error: 'ratio deve estar entre 0.01 e 0.20.' }, { status: 400 });
  }

  const auth = await resolveAuth(account_id, profile_name);
  if (!auth) return NextResponse.json({ error: 'Conta/perfil sem token válido.' }, { status: 404 });

  try {
    const created = await createLookalike({
      accountId: account_id,
      token: auth.token,
      name,
      origin_audience_id,
      ratio: r,
      country,
      type: type === 'reach' ? 'reach' : 'similarity',
    });
    return NextResponse.json({ id: created.id, name });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
