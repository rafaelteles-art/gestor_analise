import { NextResponse } from 'next/server';
import { enqueueCampaignJobs } from '@/lib/campaign-jobs';
import { resolveAuth } from '../_helpers';
import { toDatetimeLocal } from '@/lib/timezone';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/campaigns/create  — ENQUEUE-ONLY (ADR-0005)
 *
 * Was synchronous NDJSON streaming (campaign→adset→ad on the Graph API). It now
 * only validates + freezes context + inserts jobs into the per-Profile
 * `campaign_jobs` queue; the actual creation runs in the worker
 * (lib/campaign-jobs.ts → runQueueTick), driven by the cron poller and the
 * browser kick (/api/campaigns/queue/tick).
 *
 * Accepts the same payload shapes as before:
 *   1) Legado: { account_id | account_ids[], profile_name?, campaign, adset, ads }
 *   2) Batch:  { account_id | account_ids[], profile_name?, batch: {…} }
 *
 * Multi-account broadcast (account_ids.length ≥ 2): one job per ad account,
 * sharing a broadcast_group_id. Single account: one job (still stamped with a
 * group id for consistent history grouping).
 *
 * Naming context ({{data}}/{{hora}}/…) is FROZEN NOW into each job's payload as
 * `frozen_context` (computed via the GMT-3 helpers — never raw new Date()), so a
 * job that runs hours later still uses the enqueue-time clock.
 *
 * Optional `reenqueue_of: number` records provenance from the fila history page;
 * when present any incoming `frozen_context` is stripped and recomputed fresh.
 *
 * Response: 202 { jobs: [{ id, account_id, profile_name }], broadcast_group_id }.
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

  const isBatch = !!(body as any).batch;

  // Validação prévia do payload — falha cedo se faltar algo (mesma validação
  // que a rota síncrona antiga fazia antes de abrir o stream).
  if (isBatch) {
    const b = (body as any).batch;
    if (!b || !b.campaign || !b.adset || !Array.isArray(b.creatives) || b.creatives.length === 0) {
      return NextResponse.json(
        { error: 'batch.campaign, batch.adset e batch.creatives são obrigatórios.' },
        { status: 400 }
      );
    }
  } else {
    const { campaign, adset, ads } = body as any;
    if (!campaign || !adset || !Array.isArray(ads) || ads.length === 0) {
      return NextResponse.json(
        { error: 'campaign, adset, ads (não-vazio) são obrigatórios.' },
        { status: 400 }
      );
    }
  }

  // reenqueue_of: provenance from the fila page. When present we force a fresh
  // frozen_context (the history payload may carry a stale one).
  const reenqueueOfRaw = (body as any).reenqueue_of;
  const reenqueueOf =
    typeof reenqueueOfRaw === 'number' && Number.isFinite(reenqueueOfRaw)
      ? reenqueueOfRaw
      : undefined;

  // Separation level (A2 orchestrator consumes this). Default 'campaign' = legacy.
  const separationLevel = (body as any).separation_level;

  // FREEZE the date/time substitution context NOW, in GMT-3, exactly as the
  // orchestrator's baseCtx does (toDatetimeLocal → 'YYYY-MM-DDTHH:mm'). The
  // worker passes this through to substituteDirectAdsVars instead of new Date().
  const nowLocal = toDatetimeLocal();
  const frozenDateParts = {
    ano: nowLocal.slice(0, 4),
    mes: nowLocal.slice(5, 7),
    dia: nowLocal.slice(8, 10),
    hora: nowLocal.slice(11, 13),
    minuto: nowLocal.slice(14, 16),
  };

  const broadcast_group_id = globalThis.crypto.randomUUID();
  const jobsToInsert: {
    profile_name: string;
    account_id: string;
    account_name: string | null;
    payload: any;
  }[] = [];
  const authFailures: { account_id: string; error: string }[] = [];

  for (const acctId of accountIds) {
    const auth = await resolveAuth(acctId, profile_name);
    if (!auth) {
      authFailures.push({ account_id: acctId, error: 'Conta/perfil sem token válido.' });
      continue;
    }

    // The frozen context merges any user-supplied context (account name, pixel,
    // estrutura, etc. — already passed by the builder) with the frozen date
    // parts. account_id defaults into conta_id like the orchestrator does.
    const userContext =
      (isBatch ? (body as any).batch?.context : (body as any).context) ?? {};
    const frozen_context = {
      ...userContext,
      conta_id: userContext.conta_id ?? acctId,
      conta_nome: userContext.conta_nome ?? auth.account_name,
      ...frozenDateParts,
    };

    // Build the per-account payload the worker will hand to createCampaignBatch.
    // We keep the original request shape (batch vs legacy) and inject the frozen
    // token + account_id + frozen_context + separation_level. We strip any
    // client-provided frozen_context (esp. on re-enqueue) and recompute above.
    const basePayload: any = {
      ...body,
      account_id: acctId,
      access_token: auth.token,
      profile_name: profile_name ?? null,
      separation_level: separationLevel,
      frozen_context,
      reenqueue_of: reenqueueOf,
    };
    // Remove broadcast-only / stale fields so each job payload is self-contained.
    delete basePayload.account_ids;

    jobsToInsert.push({
      profile_name: profile_name ?? 'Default',
      account_id: acctId,
      account_name: auth.account_name ?? null,
      payload: basePayload,
    });
  }

  if (jobsToInsert.length === 0) {
    return NextResponse.json(
      { error: 'Nenhuma conta com token válido.', failures: authFailures },
      { status: 400 }
    );
  }

  const { ids } = await enqueueCampaignJobs(jobsToInsert, { broadcast_group_id });

  const jobs = ids.map((id, i) => ({
    id,
    account_id: jobsToInsert[i].account_id,
    profile_name: jobsToInsert[i].profile_name,
  }));

  return NextResponse.json(
    {
      jobs,
      broadcast_group_id,
      ...(authFailures.length ? { failures: authFailures } : {}),
    },
    { status: 202 }
  );
}
