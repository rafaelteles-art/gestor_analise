import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { ensureOfferLinkSchema } from '@/lib/offer-links';

type Kind = 'campaign' | 'player' | 'account';

/**
 * POST /api/ofertas/link
 * body: { kind: 'campaign' | 'player', id: string, oferta_id: number | null }
 * Define (ou limpa, com null) a oferta de UMA campanha RedTrack ou UM player vturb.
 *
 * body: { kind: 'account', id: string, oferta_id: number, linked: boolean }
 * Adiciona (linked=true) ou remove (linked=false) UMA linha em meta_account_offers.
 */
export async function POST(req: NextRequest) {
  try {
    await ensureOfferLinkSchema();
    const body = await req.json();
    const kind: Kind = body?.kind;
    const id = String(body?.id ?? '').trim();

    if (kind !== 'campaign' && kind !== 'player' && kind !== 'account') {
      return NextResponse.json({ success: false, error: 'kind inválido' }, { status: 400 });
    }
    if (!id) {
      return NextResponse.json({ success: false, error: 'id obrigatório' }, { status: 400 });
    }

    // ── account branch: N:N join table add/remove ──────────────────────────
    if (kind === 'account') {
      const ofertaId = body?.oferta_id == null ? null : Number(body.oferta_id);
      if (ofertaId === null || !Number.isInteger(ofertaId)) {
        return NextResponse.json(
          { success: false, error: 'oferta_id obrigatório e deve ser inteiro' },
          { status: 400 },
        );
      }
      const linked: boolean = body.linked === true;

      if (linked) {
        await pool.query(
          `INSERT INTO meta_account_offers (account_id, oferta_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [id, ofertaId],
        );
      } else {
        await pool.query(
          `DELETE FROM meta_account_offers WHERE account_id = $1 AND oferta_id = $2`,
          [id, ofertaId],
        );
      }
      return NextResponse.json({ success: true });
    }

    // ── campaign / player branch: single-FK UPDATE ─────────────────────────
    const ofertaId = body?.oferta_id == null ? null : Number(body.oferta_id);
    if (ofertaId !== null && !Number.isInteger(ofertaId)) {
      return NextResponse.json({ success: false, error: 'oferta_id inválido' }, { status: 400 });
    }

    if (kind === 'campaign') {
      await pool.query(
        `UPDATE redtrack_campaign_selections SET oferta_id = $1 WHERE campaign_id = $2`,
        [ofertaId, id],
      );
    } else {
      await pool.query(
        `UPDATE vturb_players SET oferta_id = $1 WHERE player_id = $2`,
        [ofertaId, id],
      );
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('POST /api/ofertas/link error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
