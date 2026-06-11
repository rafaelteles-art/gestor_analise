import { NextRequest, NextResponse } from 'next/server';
import { fetchAndSyncMetaAccounts } from '@/lib/meta-accounts';
import { withAccountSyncLock, recordAccountSyncRun } from '@/lib/account-sync';

export const maxDuration = 1200;
export const dynamic = 'force-dynamic';

/**
 * POST /api/cron/accounts-sync
 *
 * Disparado pelo Cloud Scheduler de hora em hora (`0 * * * *`, America/Sao_Paulo).
 * Roda UM Account Sync de ponta a ponta: varre as BMs de cada Profile, descobre
 * novas Ad Accounts e atualiza o account_status/metadata de todas (upsert).
 *
 * Decisões (ver docs/adr/0004):
 *  - One-shot, não-streaming, no canal de 1200s — diferente do pages-sync chunked,
 *    porque o workload é mais leve, idempotente e roda de novo na próxima hora.
 *  - Advisory lock compartilhado com o /api/accounts/sync manual: dois BM-walks
 *    nunca rodam concorrentes. Se já houver um rodando, este tick é pulado.
 *  - Chama o handler da lib direto (não via HTTP) pra evitar problemas de origin
 *    no Cloud Run, igual ao daily-sync.
 *
 * Auth: header `Authorization: Bearer <CRON_SECRET>` ou `?key=<CRON_SECRET>`.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET não configurado.' }, { status: 500 });
  }

  const provided = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    || (req.nextUrl.searchParams.get('key') ?? '');
  if (provided !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();

  let locked;
  try {
    locked = await withAccountSyncLock(() => fetchAndSyncMetaAccounts());
  } catch (err: any) {
    // O scan em si lançou (falha dura). Registra pra que o monitoramento veja.
    const message = err?.message ?? String(err);
    await recordAccountSyncRun({ ran_at_ms: startedAt, ok: false, count: null, elapsed_ms: Date.now() - startedAt, error: message, source: 'cron' });
    console.error('[cron/accounts-sync] erro:', message);
    return NextResponse.json({ ran: true, ok: false, error: message }, { status: 207 });
  }

  if (!locked.ran) {
    // Outro Account Sync (cron anterior ou scan manual) ainda está em andamento.
    // Não registramos: nada rodou.
    return NextResponse.json({ ran: false, reason: locked.reason });
  }

  const count = locked.result.count;
  await recordAccountSyncRun({ ran_at_ms: startedAt, ok: true, count, elapsed_ms: Date.now() - startedAt, source: 'cron' });
  return NextResponse.json({ ran: true, ok: true, count, elapsedMs: Date.now() - startedAt });
}
