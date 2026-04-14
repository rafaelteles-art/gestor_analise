import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

const ALLOWED_STATUS = ['ATIVO', 'PAUSADO'] as const;
type OfertaStatus = typeof ALLOWED_STATUS[number];

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ofertas (
      id SERIAL PRIMARY KEY,
      nome VARCHAR(255) NOT NULL UNIQUE,
      status VARCHAR(20) NOT NULL DEFAULT 'ATIVO',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function GET() {
  try {
    await ensureTable();
    const res = await pool.query(
      `SELECT id, nome, status, created_at FROM ofertas ORDER BY nome ASC`
    );
    return NextResponse.json({ success: true, ofertas: res.rows });
  } catch (error: any) {
    console.error('GET /api/ofertas error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureTable();
    const body = await req.json();
    const nome = (body?.nome ?? '').trim();
    const status: OfertaStatus = ALLOWED_STATUS.includes(body?.status) ? body.status : 'ATIVO';

    if (!nome) {
      return NextResponse.json({ success: false, error: 'Nome é obrigatório' }, { status: 400 });
    }

    const res = await pool.query(
      `INSERT INTO ofertas (nome, status) VALUES ($1, $2)
       ON CONFLICT (nome) DO UPDATE SET status = EXCLUDED.status
       RETURNING id, nome, status, created_at`,
      [nome, status]
    );
    return NextResponse.json({ success: true, oferta: res.rows[0] });
  } catch (error: any) {
    console.error('POST /api/ofertas error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, status } = body ?? {};

    if (!id) {
      return NextResponse.json({ success: false, error: 'id obrigatório' }, { status: 400 });
    }
    if (!ALLOWED_STATUS.includes(status)) {
      return NextResponse.json({ success: false, error: 'status inválido' }, { status: 400 });
    }

    await pool.query(`UPDATE ofertas SET status = $1 WHERE id = $2`, [status, id]);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('PATCH /api/ofertas error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: 'id obrigatório' }, { status: 400 });
    }

    await pool.query(`DELETE FROM ofertas WHERE id = $1`, [id]);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('DELETE /api/ofertas error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
