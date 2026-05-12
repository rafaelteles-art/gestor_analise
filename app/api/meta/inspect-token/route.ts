import { NextResponse } from 'next/server';
import { inspectMetaToken } from '@/lib/meta-token-inspect';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/meta/inspect-token
 * Body: { token: string }
 *
 * Recebe via POST (não GET) para o token não ficar em logs/URLs.
 * Retorna detalhes de inspeção: usuário, scopes concedidos, faltantes, canPublish.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) return NextResponse.json({ error: 'token é obrigatório' }, { status: 400 });

  const result = await inspectMetaToken(token);
  return NextResponse.json(result);
}
