import { fetchAndSyncMetaAccounts } from '@/lib/meta-accounts';
import { fetchAndSyncRedTrackCampaigns } from '@/lib/redtrack-campaigns';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

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

      try {
        send({ type: 'start', phase: 'meta', message: 'Iniciando sincronização Meta…' });

        const metaResult = await fetchAndSyncMetaAccounts((msg) => {
          send({ type: 'progress', phase: 'meta', message: msg });
        });

        send({
          type: 'progress',
          phase: 'meta',
          message: `Meta: ${metaResult.count} contas sincronizadas`,
        });

        send({ type: 'progress', phase: 'redtrack', message: 'Sincronizando RedTrack…' });

        const rtResult = await fetchAndSyncRedTrackCampaigns((msg) => {
          send({ type: 'progress', phase: 'redtrack', message: msg });
        });

        send({
          type: 'done',
          success: true,
          message: `Scaneado com sucesso. ${metaResult.count} contas Meta e ${rtResult.count} campanhas RedTrack.`,
          meta: metaResult.count,
          redtrack: rtResult.count,
        });
      } catch (error: any) {
        console.error('[accounts/sync] Error:', error?.message, error?.stack);
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
