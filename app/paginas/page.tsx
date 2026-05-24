import { pool } from '@/lib/db';
import { getMetaProfiles } from '@/lib/config';
import V2MediaLabLayout from '../components/V2MediaLabLayout';
import ClientStatusPaginas from './ClientStatusPaginas';

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS meta_pages (
      page_id              TEXT PRIMARY KEY,
      page_name            TEXT NOT NULL,
      ad_limit             INTEGER,
      ads_running          INTEGER NOT NULL DEFAULT 0,
      accessible_profiles  TEXT[]  NOT NULL DEFAULT '{}',
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export default async function PaginasPage() {
  let pages: any[] = [];
  let configuredProfiles: string[] = [];

  try {
    await ensureTable();
    const res = await pool.query(`
      SELECT
        page_id,
        page_name,
        ad_limit,
        ads_running,
        COALESCE(accessible_profiles, '{}') AS accessible_profiles,
        updated_at
      FROM meta_pages
      ORDER BY page_name ASC
    `);
    pages = res.rows;
  } catch (error) {
    console.error('Erro ao carregar páginas:', error);
  }

  try {
    const profiles = await getMetaProfiles();
    configuredProfiles = profiles.map((p) => p.name).filter(Boolean);
  } catch (error) {
    console.error('Erro ao carregar perfis Meta:', error);
  }

  return (
    <V2MediaLabLayout title="Páginas">
      <ClientStatusPaginas initialPages={pages} configuredProfiles={configuredProfiles} />
    </V2MediaLabLayout>
  );
}
