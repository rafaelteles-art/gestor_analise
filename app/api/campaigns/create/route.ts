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
 *      { account_id | account_ids[], profile_name?, campaign, adset, ads }
 *   2) Batch (multiplicador):
 *      { account_id | account_ids[], profile_name?, batch: { campaigns_per_creative, adsets_per_campaign,
 *        ads_per_adset, page_ids, page_auto_retry, campaign, adset, creatives } }
 *
 * Broadcast multi-conta: se `account_ids` for um array com 2+ entradas, executa o mesmo
 * payload sequencialmente em cada conta, emitindo `account_start`/`account_done`/`account_error`
 * em volta de cada execução e um `broadcast_summary` no fim. Em modo single-account
 * (apenas `account_id` ou `account_ids` com 1 entrada) o comportamento legado é preservado
 * — nada de eventos broadcast.
 *
 * Resposta: NDJSON streaming em ambos os casos.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'body JSON inválido' }, { status: 400 });
  }

  const { profile_name } = body as { profile_name?: string };

  // Aceita account_ids[] (multi-conta) ou account_id (single). Backward-compatible.
  const rawIds: unknown = (body as any).account_ids;
  const singleId: unknown = (body as any).account_id;
  const accountIds: string[] = Array.isArray(rawIds) && rawIds.length > 0
    ? rawIds.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : (typeof singleId === 'string' && singleId.trim().length > 0 ? [singleId] : []);
  if (accountIds.length === 0) {
    return NextResponse.json({ error: 'Campos obrigatórios: account_id ou account_ids[].' }, { status: 400 });
  }

  const isBroadcast = accountIds.length > 1;
  const isBatch = !!body.batch;

  // Validação prévia do payload — falha cedo se faltar algo, evita abrir
  // stream pra erro de schema.
  if (isBatch) {
    const b = body.batch;
    if (!b || !b.campaign || !b.adset || !Array.isArray(b.creatives) || b.creatives.length === 0) {
      return NextResponse.json(
        { error: 'batch.campaign, batch.adset e batch.creatives são obrigatórios.' },
        { status: 400 }
      );
    }
  } else {
    const { campaign, adset, ads } = body;
    if (!campaign || !adset || !Array.isArray(ads) || ads.length === 0) {
      return NextResponse.json(
        { error: 'campaign, adset, ads (não-vazio) são obrigatórios.' },
        { status: 400 }
      );
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Conta ads efetivamente publicados por página (somando todas as contas
      // em broadcast) — usado pra incrementar `meta_pages.ads_running` no DB
      // uma única vez no fim. Acumula via eventos, então mesmo em falha parcial
      // os ads já criados são contabilizados.
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

      // Resultado por conta — agregado pro broadcast_summary final.
      const success: Array<{ account_id: string; campaign_ids: string[]; adset_ids: string[]; ad_ids: string[] }> = [];
      const failed: Array<{ account_id: string; error: string }> = [];

      try {
        for (let idx = 0; idx < accountIds.length; idx++) {
          const acctId = accountIds[idx];

          if (isBroadcast) {
            send({ type: 'account_start', account_id: acctId, index: idx, total: accountIds.length });
          }

          // Wrapper que injeta `account_id` em todo evento — UI usa pra agrupar
          // progresso por conta no modo broadcast. Em single-account, injeta
          // mesmo assim (custo zero) pra manter shape consistente.
          const accountSend = (e: OrchestratorEvent) => send({ ...e, account_id: acctId });

          try {
            const acctAuth = await resolveAuth(acctId, profile_name);
            if (!acctAuth) {
              const err = 'Conta/perfil sem token válido.';
              failed.push({ account_id: acctId, error: err });
              if (isBroadcast) {
                send({ type: 'account_error', account_id: acctId, error: err });
                continue;
              } else {
                // Single-account: comportamento legado — encerra com erro HTTP-style.
                send({ type: 'error', step: 'auth', error: err, account_id: acctId });
                return;
              }
            }

            if (isBatch) {
              const b = body.batch;
              const payload: BatchCreateInput = {
                account_id: acctId,
                access_token: acctAuth.token,
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
              const result = await createCampaignBatch(payload, accountSend);
              success.push({
                account_id: acctId,
                campaign_ids: result.campaign_ids,
                adset_ids: result.adset_ids,
                ad_ids: result.ad_ids,
              });
            } else {
              const { campaign, adset, ads } = body;
              const payload: CreateFullCampaignInput = {
                account_id: acctId,
                access_token: acctAuth.token,
                campaign,
                adset,
                ads,
              };
              const result = await createFullCampaign(payload, accountSend);
              // createFullCampaign retorna shape diferente — normalizamos para o summary.
              success.push({
                account_id: acctId,
                campaign_ids: result.campaign_id ? [result.campaign_id] : [],
                adset_ids: result.adset_id ? [result.adset_id] : [],
                ad_ids: Array.isArray(result.ad_ids) ? result.ad_ids : [],
              });
            }

            if (isBroadcast) {
              send({ type: 'account_done', account_id: acctId, index: idx, total: accountIds.length });
            }
          } catch (e: any) {
            const errMsg = e?.message ?? String(e);
            failed.push({ account_id: acctId, error: errMsg });
            if (isBroadcast) {
              // Em broadcast, segue pra próxima conta.
              send({ type: 'account_error', account_id: acctId, error: errMsg });
            } else {
              // Single-account: erro já foi emitido como evento pelo orquestrador.
              // Não rethrow — apenas sai do loop.
              break;
            }
          }
        }

        if (isBroadcast) {
          send({
            type: 'broadcast_summary',
            total: accountIds.length,
            success,
            failed,
          });
        }
      } finally {
        // Commit dos incrementos em meta_pages.ads_running. Sempre tenta —
        // mesmo em falha parcial, ads que foram criados na Meta devem ser
        // contabilizados localmente para não estourar o limite na próxima
        // execução. Falhas aqui não afetam o stream para o cliente.
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
