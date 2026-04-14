import { pool } from '@/lib/db';
import V2MediaLabLayout from '../components/V2MediaLabLayout';
import ClientOfertas from './ClientOfertas';

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

export default async function OfertasPage() {
  let ofertas: any[] = [];

  try {
    await ensureTable();
    const res = await pool.query(
      `SELECT id, nome, status, created_at FROM ofertas ORDER BY nome ASC`
    );
    ofertas = res.rows;
  } catch (error) {
    console.error('Erro ao carregar ofertas:', error);
  }

  return (
    <V2MediaLabLayout title="Ofertas">
      <ClientOfertas initialOfertas={ofertas} />
    </V2MediaLabLayout>
  );
}
