import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local', 'utf8');
const DATABASE_URL = env.match(/^DATABASE_URL=(.*)$/m)[1].trim();
const KEY = env.match(/^REDTRACK_API_KEY=(.*)$/m)[1].trim();
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

const RT_ID = '691250b7c3f17e8305b9b82a';
const DATE = '2026-04-14';

async function fetchRt(group) {
  const url = `https://api.redtrack.io/report?api_key=${KEY}&tz=America/Sao_Paulo&date_from=${DATE}&date_to=${DATE}&group=${group}&campaign_id=${RT_ID}&per=30&page=1`;
  const r = await fetch(url);
  const data = await r.json();
  return Array.isArray(data) ? data : (data?.data || []);
}

for (const g of ['sub1','sub2','sub3']) {
  const rows = await fetchRt(g);
  const ids = rows.map(r => r[g]).filter(Boolean).slice(0, 10);
  const result = await pool.query(
    `SELECT DISTINCT campaign_id FROM meta_ads_metrics WHERE campaign_id = ANY($1::text[]) LIMIT 5`,
    [ids]
  );
  console.log(`${g}: ${ids.length} ids sampled, ${result.rows.length} match meta campaign_id`);
  console.log(`  sample ids: ${ids.slice(0,3).join(', ')}`);
  if (result.rows.length) console.log(`  MATCH: ${result.rows.map(r=>r.campaign_id).join(', ')}`);
  await new Promise(r=>setTimeout(r, 1500));
}

await pool.end();
