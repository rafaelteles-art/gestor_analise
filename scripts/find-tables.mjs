import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8');
const DATABASE_URL = env.match(/^DATABASE_URL=(.*)$/m)[1].trim();
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl:{rejectUnauthorized:false}});

const r = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`);
for (const c of r.rows) console.log(c.table_name);
await pool.end();
