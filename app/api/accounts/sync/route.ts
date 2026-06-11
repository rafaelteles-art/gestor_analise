import { fetchAndSyncMetaAccounts } from '@/lib/meta-accounts';
import { withAccountSyncLock, recordAccountSyncRun } from '@/lib/account-sync';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// Escaneia apenas contas de anúncio do Meta (BMs + personal + owned).
// O sync de campanhas do RedTrack roda no painel do RedTrack, não aqui.
export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
        } catch {
          // cliente desconectou
        }
      };

      const startedAt = Date.now();
      try {
        send({ type: 'start', phase: 'meta', message: 'Iniciando sincronização Meta…' });

        // Advisory lock compartilhado com o cron horário (/api/cron/accounts-sync):
        // se já houver um Account Sync rodando, não inicia um segundo BM-walk.
        const locked = await withAccountSyncLock(() =>
          fetchAndSyncMetaAccounts((msg) => {
            send({ type: 'progress', phase: 'meta', message: msg });
          })
        );

        if (!locked.ran) {
          send({ type: 'error', success: false, error: 'Sincronização de contas já em andamento. Tente novamente em instantes.' });
          return;
        }

        const count = locked.result.count;
        await recordAccountSyncRun({ ran_at_ms: startedAt, ok: true, count, elapsed_ms: Date.now() - startedAt, source: 'manual' });

        send({
          type: 'done',
          success: true,
          message: `Scaneado com sucesso. ${count} contas Meta.`,
          meta: count,
        });
      } catch (error: any) {
        console.error('[accounts/sync] Error:', error?.message, error?.stack);
        await recordAccountSyncRun({ ran_at_ms: startedAt, ok: false, count: null, elapsed_ms: Date.now() - startedAt, error: error?.message ?? String(error), source: 'manual' });
        send({ type: 'error', success: false, error: error?.message ?? String(error) });
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
