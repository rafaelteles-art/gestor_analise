import { NextResponse } from 'next/server';
import pg from 'pg';
const { Pool } = pg;

let sharedPoolStatus = 'not tested';
let sharedPoolError: string | null = null;
try {
  const { pool } = await import('@/lib/db');
  const client = await pool.connect();
  await client.query('SELECT 1');
  client.release();
  sharedPoolStatus = 'ok';
} catch (e: any) {
  sharedPoolStatus = 'error';
  sharedPoolError = e.message;
}

export async function GET() {
  const dbUrl = process.env.DATABASE_URL;

  const masked = dbUrl
    ? dbUrl.replace(/:([^:@]+)@/, ':<REDACTED>@')
    : 'NOT SET';

  let dbStatus = 'untested';
  let dbError = null;

  if (dbUrl) {
    try {
      const pool = new Pool({
        connectionString: dbUrl,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 8000,
      });
      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();
      await pool.end();
      dbStatus = 'ok';
    } catch (e: any) {
      dbStatus = 'error';
      dbError = e.message;
    }
  }

  return NextResponse.json({
    env: {
      DATABASE_URL: masked,
      NODE_ENV: process.env.NODE_ENV,
      META_PROFILES_SET: !!process.env.META_PROFILES,
      META_ACCESS_TOKEN_SET: !!process.env.META_ACCESS_TOKEN,
    },
    db: { status: dbStatus, error: dbError },
    sharedPool: { status: sharedPoolStatus, error: sharedPoolError },
  });
}
