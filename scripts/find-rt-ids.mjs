import pg from 'pg';
import fs from 'fs';
const DATABASE_URL = fs.readFileSync('.env.local','utf8').match(/^DATABASE_URL=(.*)$/m)[1].trim();
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

const needles = [
  'LOTTO V7 ND DOMINIO',
  'LOTTO SYLVESTER',
  'BIBLICAL DIABETES',
  'GLP CASEIRO NEW',
  'BIBLICAL Memoria',
  'LOTTO V7.*RAFA.*REMARKETING',
  'AFI BIBLICAL DIABETES',
  'AFI CLICKBANK GLUCO CONTROL',
  '1518',
];

for (const n of needles) {
  const r = await pool.query(
    `SELECT campaign_id, campaign_name FROM redtrack_campaign_selections WHERE campaign_name ~* $1 ORDER BY campaign_name`,
    [n]
  );
  console.log(`\n[${n}]  → ${r.rows.length} matches`);
  for (const row of r.rows) console.log(`  ${row.campaign_id}  ${row.campaign_name}`);
}
await pool.end();
