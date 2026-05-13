import { NextResponse } from 'next/server';
import {
  createCampaignBatch,
  createFullCampaign,
  type BatchCreateInput,
  type CreateFullCampaignInput,
  type OrchestratorEvent,
} from '@/lib/meta-campaigns';
import { resolveAuth } from '../_helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * POST /api/campaigns/create
 *
 * Aceita dois formatos:
 *   1) Legado (1 campanha × 1 conjunto × N ads):
 *      { account_id, profile_name?, campaign, adset, ads }
 *   2) Batch (multiplicador):
 *      { account_id, profile_name?, batch: { campaigns_per_creative, adsets_per_campaign,
 *        ads_per_adset, page_ids, page_auto_retry, campaign, adset, creatives } }
 *
 * Resposta: NDJSON streaming em ambos os casos.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'body JSON inválido' }, { status: 400 });
  }

  const { account_id, profile_name } = body as { account_id?: string; profile_name?: string };
  if (!account_id) {
    return NextResponse.json({ error: 'Campos obrigatórios: account_id.' }, { status: 400 });
  }

  const auth = await resolveAuth(account_id, profile_name);
  if (!auth) return NextResponse.json({ error: 'Conta/perfil sem token válido.' }, { status: 404 });

  const isBatch = !!body.batch;
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
        if (isBatch) {
          const b = body.batch;
          if (!b.campaign || !b.adset || !Array.isArray(b.creatives) || b.creatives.length === 0) {
            send({ type: 'error', step: 'validate', error: 'batch.campaign, batch.adset e batch.creatives são obrigatórios.' });
            return;
          }
          const payload: BatchCreateInput = {
            account_id,
            access_token: auth.token,
            campaigns_per_creative: Math.max(1, Number(b.campaigns_per_creative) || 1),
            adsets_per_campaign: Math.max(1, Number(b.adsets_per_campaign) || 1),
            ads_per_adset: Math.max(1, Number(b.ads_per_adset) || 1),
            page_ids: Array.isArray(b.page_ids) ? b.page_ids : [],
            page_auto_retry: Boolean(b.page_auto_retry),
            campaign: b.campaign,
            adset: b.adset,
            creatives: b.creatives,
            url_tags_template: typeof b.url_tags_template === 'string' && b.url_tags_template.trim()
              ? b.url_tags_template
              : undefined,
            context: b.context && typeof b.context === 'object' ? b.context : undefined,
          };
          await createCampaignBatch(payload, send);
        } else {
          const { campaign, adset, ads } = body;
          if (!campaign || !adset || !Array.isArray(ads) || ads.length === 0) {
            send({ type: 'error', step: 'validate', error: 'campaign, adset, ads (não-vazio) são obrigatórios.' });
            return;
          }
          const payload: CreateFullCampaignInput = {
            account_id,
            access_token: auth.token,
            campaign,
            adset,
            ads,
          };
          await createFullCampaign(payload, send);
        }
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
