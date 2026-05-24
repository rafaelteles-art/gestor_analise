import { NextResponse } from 'next/server';
import {
  createCampaignBatch,
  createFullCampaign,
  type BatchCreateInput,
  type CreateFullCampaignInput,
  type OrchestratorEvent,
} from '@/lib/meta-campaigns';
import { pool } from '@/lib/db';
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
      // Conta ads efetivamente publicados por página — usado depois para
      // incrementar `meta_pages.ads_running` no DB (atualiza vagas livres
      // em tempo real). Acumula via eventos, então mesmo em caso de
      // falha parcial os ads já criados são contabilizados.
      const adsPerPage = new Map<string, number>();
      const send = (e: OrchestratorEvent) => {
        if (e.type === 'ad_created' && e.page_id) {
          adsPerPage.set(e.page_id, (adsPerPage.get(e.page_id) ?? 0) + 1);
        }
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
            page_allocations: (b.page_allocations && typeof b.page_allocations === 'object')
              ? Object.fromEntries(
                  Object.entries(b.page_allocations as Record<string, unknown>)
                    .map(([k, v]) => [k, Math.max(0, Number(v) || 0)])
                )
              : undefined,
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
        // Commit dos incrementos em meta_pages.ads_running. Sempre tenta
        // — mesmo em falha parcial, ads que foram criados na Meta devem
        // ser contabilizados localmente para não estourar o limite na
        // próxima execução. Falhas aqui não afetam o stream para o cliente.
        if (adsPerPage.size > 0) {
          try {
            const ids: string[] = [];
            const deltas: number[] = [];
            for (const [id, n] of adsPerPage) {
              if (n > 0) { ids.push(id); deltas.push(n); }
            }
            if (ids.length > 0) {
              await pool.query(
                `UPDATE meta_pages AS m
                    SET ads_running = ads_running + d.delta,
                        updated_at  = now()
                   FROM UNNEST($1::text[], $2::int[]) AS d(page_id, delta)
                  WHERE m.page_id = d.page_id`,
                [ids, deltas]
              );
            }
          } catch (e) {
            // Não relançar — não vale derrubar a resposta. Próxima sincronização
            // via /api/pages/sync reconcilia a contagem com a fonte da verdade.
            console.error('[campaigns/create] falha ao atualizar meta_pages.ads_running:', e);
          }
        }
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
