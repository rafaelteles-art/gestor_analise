import pg from 'pg';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
const DATABASE_URL = env.match(/^DATABASE_URL=(.*)$/m)[1].trim();
const KEY = env.match(/^REDTRACK_API_KEY=(.*)$/m)[1].trim();
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

const RT_ID = '691250b7c3f17e8305b9b82a';
const ACC_ID = 'act_4248841835333178';
const DATE = '2026-04-14';

async function fetchPaginated(url) {
  const all = [];
  let page = 1;
  while (true) {
    const r = await fetch(`${url}&per=1000&page=${page}`, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
    const data = await r.json();
    const arr = Array.isArray(data) ? data : (data?.data || []);
    if (!arr.length) break;
    all.push(...arr);
    if (arr.length < 1000) break;
    page++;
  }
  return all;
}

// 1. Fetch sub3 grouping from RedTrack
console.log(`Fetching sub3 group from RedTrack for rt_campaign=${RT_ID} date=${DATE}...`);
const rtCampById = await fetchPaginated(
  `https://api.redtrack.io/report?api_key=${KEY}&tz=America/Sao_Paulo&date_from=${DATE}&date_to=${DATE}&group=sub3&campaign_id=${RT_ID}`
);
console.log(`  → ${rtCampById.length} rows`);

// 2. Upsert into import_cache as rt_camp_id:<RT_ID>
await pool.query(
  `INSERT INTO import_cache (cache_key, date_from, date_to, data, synced_at)
   VALUES ($1, $2, $2, $3, NOW())
   ON CONFLICT (cache_key, date_from, date_to) DO UPDATE SET
     data = EXCLUDED.data, synced_at = NOW()`,
  [`rt_camp_id:${RT_ID}`, DATE, JSON.stringify(rtCampById)]
);
console.log(`  → cache rt_camp_id:${RT_ID} written\n`);

// 3. Reproduce dashboard totals with the new id-based logic
const meta = await pool.query(
  `SELECT campaign_id, campaign_name, SUM(spend) spend FROM meta_ads_metrics
   WHERE account_id=$1 AND date=$2 GROUP BY campaign_id, campaign_name`,
  [ACC_ID, DATE]
);
const rtAdRows = await pool.query(
  `SELECT data FROM import_cache WHERE cache_key=$1 AND date_from=$2 AND date_to=$2`,
  [`rt_ad:${RT_ID}`, DATE]
);
const rtCampRows = await pool.query(
  `SELECT data FROM import_cache WHERE cache_key=$1 AND date_from=$2 AND date_to=$2`,
  [`rt_camp:${RT_ID}`, DATE]
);

const rtAdSet = new Set();
for (const r of rtAdRows.rows) for (const e of (r.data||[])) if (e.rt_ad) rtAdSet.add(e.rt_ad);

// Build rtByMetaId from the freshly-written cache row
const rtByMetaId = new Map();
for (const e of rtCampById) {
  const metaId = e.sub3;
  if (!metaId) continue;
  const cur = rtByMetaId.get(metaId) || { total_revenue: 0, convtype2: 0 };
  cur.total_revenue += parseFloat(e.total_revenue||0);
  cur.convtype2 += parseInt(e.convtype2||0, 10);
  rtByMetaId.set(metaId, cur);
}

// Build rtCampByName for fallback
const rtCampByName = new Map();
for (const row of rtCampRows.rows)
  for (const e of (row.data||[]))
    if (e.rt_campaign) rtCampByName.set(e.rt_campaign, e);

const findRtCamp = (name) => {
  const low = name.toLowerCase();
  const matches = [];
  for (const [rtName, rtCamp] of rtCampByName) {
    if (rtName === name || (rtName.length > 10 && low.includes(rtName.toLowerCase()))) matches.push(rtCamp);
  }
  if (!matches.length) return null;
  if (matches.length === 1) return matches[0];
  return {
    convtype2: String(matches.reduce((s,c)=>s+parseInt(c.convtype2||0,10),0)),
    total_revenue: String(matches.reduce((s,c)=>s+parseFloat(c.total_revenue||0),0)),
  };
};

const findRevenue = (mc) => {
  const byId = rtByMetaId.get(mc.campaign_id);
  if (byId) return { total_revenue: String(byId.total_revenue), convtype2: String(byId.convtype2) };
  return findRtCamp(mc.campaign_name);
};

const usd = 5.5;
let dashCost = 0, dashRev = 0, dashConv = 0;
let viaId = 0, viaName = 0, viaNone = 0;

for (const rtAd of rtAdSet) {
  const escaped = rtAd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(`(?:^|[^a-zA-Z0-9_.])` + escaped + `(?:[^a-zA-Z0-9_.]|$)`, 'i');
  const matching = meta.rows.filter(r => rx.test(r.campaign_name));
  if (!matching.length) continue;
  for (const mc of matching) {
    const spendBrl = parseFloat(mc.spend) * usd;
    const rtCamp = findRevenue(mc);
    const rev = rtCamp ? parseFloat(rtCamp.total_revenue || 0) : 0;
    const conv = rtCamp ? parseInt(rtCamp.convtype2 || 0, 10) : 0;
    if (rtByMetaId.get(mc.campaign_id)) viaId++;
    else if (rtCamp) viaName++;
    else viaNone++;
    dashCost += spendBrl;
    dashRev += rev;
    dashConv += conv;
  }
}

console.log('=== NEW DASHBOARD TOTALS (id-based join) ===');
console.log(`  Revenue: R$${dashRev.toFixed(2)}`);
console.log(`  Conv:    ${dashConv}`);
console.log(`  Cost:    R$${dashCost.toFixed(2)}`);
console.log(`  Matches via sub3 id:   ${viaId}`);
console.log(`  Matches via name only: ${viaName}`);
console.log(`  No match:              ${viaNone}`);

console.log('\n=== EXPECTED (RedTrack UI) ===');
console.log(`  Revenue: R$106396.29`);
console.log(`  Conv:    91`);

console.log('\n=== PREVIOUS DASHBOARD (name-only) ===');
console.log(`  Revenue: R$90441.06`);
console.log(`  Conv:    77`);

await pool.end();
