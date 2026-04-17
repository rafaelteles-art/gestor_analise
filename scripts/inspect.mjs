import pg from 'pg';
import fs from 'fs';
const DATABASE_URL = fs.readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=(.*)$/m)[1].trim();
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
for (const t of ['meta_ad_accounts','redtrack_campaign_selections','import_cache','meta_ads_metrics','redtrack_metrics']) {
  const r = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`, [t]);
  console.log(`\n${t}:`);
  console.table(r.rows);
}
await pool.end();
