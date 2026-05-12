import { NextResponse } from 'next/server';
import {
  createFullCampaign,
  type CreateFullCampaignInput,
  type OrchestratorEvent,
} from '@/lib/meta-campaigns';
import { resolveAuth } from '../_helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * POST /api/campaigns/create
 * Body: { account_id, profile_name?, campaign, adset, ads }
 *
 * Resposta: NDJSON streaming.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'body JSON inválido' }, { status: 400 });
  }
  const { account_id, profile_name, campaign, adset, ads } = body;
  if (!account_id || !campaign || !adset || !Array.isArray(ads) || ads.length === 0) {
    return NextResponse.json(
      { error: 'Campos obrigatórios: account_id, campaign, adset, ads (não-vazio).' },
      { status: 400 }
    );
  }

  const auth = await resolveAuth(account_id, profile_name);
  if (!auth) return NextResponse.json({ error: 'Conta/perfil sem token válido.' }, { status: 404 });

  const payload: CreateFullCampaignInput = {
    account_id,
    access_token: auth.token,
    campaign,
    adset,
    ads,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: OrchestratorEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + '\n'));
        } catch {
          // cliente desconectou
        }
      };
      try {
        await createFullCampaign(payload, send);
      } catch {
        // erro já emitido como evento
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
