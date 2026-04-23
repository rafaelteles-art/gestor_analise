import pg from 'pg';
import fs from 'fs';
const DATABASE_URL = fs.readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=(.*)$/m)[1].trim();
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
const tables = ['meta_ad_accounts', 'meta_ads_metrics', 'redtrack_campaign_selections', 'redtrack_metrics', 'ofertas'];
for (const t of tables) {
  const r = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [t]);
  console.log(`\n=== ${t} ===`);
  for (const row of r.rows) console.log(`  ${row.column_name} (${row.data_type})`);
}
await pool.end();
