import { fetchAndSyncRedTrackCampaigns } from '@/lib/redtrack-campaigns';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// Escaneia apenas campanhas do RedTrack e popula redtrack_campaign_selections.
// O sync de contas Meta roda em /api/accounts/sync.
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
        send({ type: 'start', phase: 'redtrack', message: 'Iniciando scan RedTrack…' });

        const rtResult = await fetchAndSyncRedTrackCampaigns((msg) => {
          send({ type: 'progress', phase: 'redtrack', message: msg });
        });

        send({
          type: 'done',
          success: true,
          message: `Scaneado com sucesso. ${rtResult.count} campanha(s) RedTrack.`,
          redtrack: rtResult.count,
        });
      } catch (error: any) {
        console.error('[accounts/sync-rt] Error:', error?.message, error?.stack);
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
