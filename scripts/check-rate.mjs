import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8');
const DATABASE_URL = env.match(/^DATABASE_URL=(.*)$/m)[1].trim();
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl:{rejectUnauthorized:false}});
const r = await pool.query(`SELECT * FROM usd_brl_rates ORDER BY date DESC LIMIT 7`);
for (const row of r.rows) console.log(row);
await pool.end();
