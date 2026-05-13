import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaign_presets (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      config JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

/**
 * GET /api/campaigns/presets
 * Lista todos os presets salvos (sincronizados entre máquinas via Postgres).
 */
export async function GET() {
  try {
    await ensureTable();
    const res = await pool.query(
      `SELECT id, name, config, created_at, updated_at
         FROM campaign_presets
        ORDER BY name ASC`
    );
    return NextResponse.json({ success: true, presets: res.rows });
  } catch (error: any) {
    console.error('GET /api/campaigns/presets error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/campaigns/presets
 * Body: { name: string, config: object }
 * Upsert por name — sobrescreve se já existir.
 */
export async function POST(req: NextRequest) {
  try {
    await ensureTable();
    const body = await req.json().catch(() => null);
    const name = (body?.name ?? '').toString().trim();
    const config = body?.config;

    if (!name) {
      return NextResponse.json({ success: false, error: 'name obrigatório' }, { status: 400 });
    }
    if (!config || typeof config !== 'object') {
      return NextResponse.json({ success: false, error: 'config (objeto) obrigatório' }, { status: 400 });
    }

    const res = await pool.query(
      `INSERT INTO campaign_presets (name, config)
            VALUES ($1, $2::jsonb)
       ON CONFLICT (name) DO UPDATE
            SET config = EXCLUDED.config,
                updated_at = NOW()
        RETURNING id, name, config, created_at, updated_at`,
      [name, JSON.stringify(config)]
    );
    return NextResponse.json({ success: true, preset: res.rows[0] });
  } catch (error: any) {
    console.error('POST /api/campaigns/presets error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/campaigns/presets?name=Foo  (ou ?id=123)
 */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const name = searchParams.get('name');
    if (!id && !name) {
      return NextResponse.json({ success: false, error: 'id ou name obrigatório' }, { status: 400 });
    }
    if (id) {
      await pool.query(`DELETE FROM campaign_presets WHERE id = $1`, [id]);
    } else {
      await pool.query(`DELETE FROM campaign_presets WHERE name = $1`, [name]);
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('DELETE /api/campaigns/presets error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
