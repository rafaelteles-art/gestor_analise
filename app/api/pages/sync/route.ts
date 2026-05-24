import { fetchAndSyncMetaPages } from '@/lib/meta-pages';
import { NextRequest } from 'next/server';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// Sincroniza páginas do Meta + seus limites de anúncios (ads_volume).
// Sem filtro: roda todos os perfis. Com `?profiles=a,b`: roda só esses.
function runSync(profileNames: string[] | undefined) {
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

        const result = await fetchAndSyncMetaPages(
          (msg) => send({ type: 'progress', phase: 'pages', message: msg }),
          profileNames && profileNames.length > 0 ? { profileNames } : undefined
        );

        send({
          type: 'done',
          success: true,
          partial: result.partial,
          message: result.partial
            ? `Salvo parcial. ${result.count} páginas (rate limit do app atingido — tente o restante em ~1h).`
            : `Sincronizado com sucesso. ${result.count} páginas.`,
          pages: result.count,
          profilesSynced: result.profilesSynced,
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

const parseProfilesQS = (req: NextRequest): string[] | undefined => {
  const raw = req.nextUrl.searchParams.get('profiles');
  if (!raw) return undefined;
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : undefined;
};

export async function GET(req: NextRequest) {
  return runSync(parseProfilesQS(req));
}

export async function POST(req: NextRequest) {
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    // sem body → roda tudo
  }
  const fromBody = Array.isArray(body?.profiles)
    ? body.profiles.filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0)
    : undefined;
  return runSync(fromBody ?? parseProfilesQS(req));
}
