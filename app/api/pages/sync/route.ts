import { fetchAndSyncMetaPages } from '@/lib/meta-pages';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// Sincroniza páginas do Meta + seus limites de anúncios (ads_volume).
// Roda em todos os perfis configurados em /api-config e deduplica por page_id.
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
        send({ type: 'start', phase: 'pages', message: 'Iniciando sincronização de páginas…' });

        const result = await fetchAndSyncMetaPages((msg) => {
          send({ type: 'progress', phase: 'pages', message: msg });
        });

        send({
          type: 'done',
          success: true,
          message: `Sincronizado com sucesso. ${result.count} páginas.`,
          pages: result.count,
        });
      } catch (error: any) {
        console.error('[pages/sync] Error:', error?.message, error?.stack);
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
