import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8');
const DATABASE_URL = env.match(/^DATABASE_URL=(.*)$/m)[1].trim();
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl:{rejectUnauthorized:false}});

for (const t of ['meta_ads_metrics', 'meta_accounts']) {
  console.log('\n== '+t+' ==');
  const r = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`, [t]);
  for (const c of r.rows) console.log('  '+c.column_name);
}
await pool.end();
