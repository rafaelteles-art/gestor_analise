import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8');
const DATABASE_URL = env.match(/^DATABASE_URL=(.*)$/m)[1].trim();
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl:{rejectUnauthorized:false}});

const ACC = 'act_210867683874813';
const r = await pool.query(
  `SELECT to_char(date,'YYYY-MM-DD') AS date, COUNT(*) AS n, SUM(spend)::float AS spend
   FROM meta_ads_metrics WHERE account_id=$1 AND date >= CURRENT_DATE - INTERVAL '14 days'
   GROUP BY date ORDER BY date DESC`,
  [ACC]
);
console.log(`CA01 - Atenas (${ACC}) últimos 14 dias:`);
for (const row of r.rows) console.log(`  ${row.date}  ${row.n} campanhas  $${row.spend.toFixed(2)}`);
await pool.end();
