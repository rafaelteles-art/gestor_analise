import pg from 'pg';
import fs from 'fs';
const DATABASE_URL = fs.readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=(.*)$/m)[1].trim();
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
const r = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1`);
console.log(r.rows.map(x=>x.table_name).join('\n'));
await pool.end();
