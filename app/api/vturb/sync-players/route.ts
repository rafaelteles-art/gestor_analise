import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { getVturbApiToken } from '@/lib/config';
import { fetchVturbPlayers } from '@/lib/vturb';
import { ensureOfferLinkSchema } from '@/lib/offer-links';

export const dynamic = 'force-dynamic';

/**
 * POST /api/vturb/sync-players
 *
 * Sincronização leve do REGISTRO de vídeos vTurb: lista os players via API e
 * faz upsert em vturb_players (NUNCA toca oferta_id — vínculo manual é preservado).
 * Sem métricas, sem fan-out por player. Usado pelo botão "Sincronizar vídeos vTurb"
 * na página de Ofertas para popular/atualizar o picker de vídeos.
 */
export async function POST() {
  try {
    const token = await getVturbApiToken();
    if (!token) {
      return NextResponse.json(
        { success: false, error: 'VTURB_API_TOKEN não configurado. Configure em Configurações.' },
        { status: 400 },
      );
    }

    await ensureOfferLinkSchema();

    const players = (await fetchVturbPlayers(token)).filter(p => (p.video_duration ?? 0) > 0);

    for (const p of players) {
      await pool.query(
        `INSERT INTO vturb_players (player_id, player_name, video_duration, pitch_time, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (player_id) DO UPDATE SET
           player_name    = EXCLUDED.player_name,
           video_duration = EXCLUDED.video_duration,
           pitch_time     = EXCLUDED.pitch_time,
           updated_at     = NOW()`,
        [p.id, p.name ?? null, p.video_duration ?? null, p.pitch_time ?? null],
      );
    }

    return NextResponse.json({ success: true, count: players.length });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
