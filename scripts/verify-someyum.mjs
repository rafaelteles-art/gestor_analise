import pg from 'pg';
import fs from 'fs';
const DATABASE_URL = fs.readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=(.*)$/m)[1].trim();
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

const DATE = '2026-04-14';
const RT_ID = '691250b7c3f17e8305b9b82a';
const ACC_ID = 'act_4248841835333178';

const rtCamp = await pool.query(
  `SELECT data FROM import_cache WHERE cache_key=$1 AND date_from=$2 AND date_to=$2`,
  [`rt_camp:${RT_ID}`, DATE]
);
const rtAd = await pool.query(
  `SELECT data FROM import_cache WHERE cache_key=$1 AND date_from=$2 AND date_to=$2`,
  [`rt_ad:${RT_ID}`, DATE]
);
const meta = await pool.query(
  `SELECT campaign_name, SUM(spend) spend FROM meta_ads_metrics WHERE account_id=$1 AND date=$2 GROUP BY campaign_name`,
  [ACC_ID, DATE]
);

const entries = [];
for (const row of rtCamp.rows) for (const e of (row.data || [])) entries.push(e);

console.log(`Total rt_camp entries: ${entries.length}`);
const nonZero = entries.filter(e => parseFloat(e.total_revenue||0) > 0);
console.log(`Non-zero rt_camp entries: ${nonZero.length}`);

// Breakdown by BM prefix
const byBm = new Map();
const bucket = (name) => {
  const m = name.match(/\[LOTTOV7\]\s*([^-\[\]]+)/i);
  if (m) return m[1].trim();
  return '??';
};
for (const e of entries) {
  const key = bucket(e.rt_campaign || '');
  const cur = byBm.get(key) || { rev: 0, conv: 0, n: 0 };
  cur.rev += parseFloat(e.total_revenue || 0);
  cur.conv += parseInt(e.convtype2 || 0, 10);
  cur.n++;
  byBm.set(key, cur);
}
console.log('\nBreakdown by BM prefix in rt_camp cache:');
for (const [k, v] of [...byBm.entries()].sort((a,b)=>b[1].rev-a[1].rev)) {
  console.log(`  ${k.padEnd(30)} n=${v.n}  rev=R$${v.rev.toFixed(2)}  conv=${v.conv}`);
}

// SomeYum specific (case-insensitive)
const someyumEntries = entries.filter(e => /someyum/i.test(e.rt_campaign || ''));
const someyumRev = someyumEntries.reduce((s,e)=>s+parseFloat(e.total_revenue||0),0);
const someyumConv = someyumEntries.reduce((s,e)=>s+parseInt(e.convtype2||0,10),0);
console.log(`\nSomeYum-named rt_camps: n=${someyumEntries.length}  rev=R$${someyumRev.toFixed(2)}  conv=${someyumConv}`);
for (const e of someyumEntries.filter(x=>parseFloat(x.total_revenue||0)>0)) {
  console.log(`  ${e.rt_campaign}  rev=${e.total_revenue}  conv=${e.convtype2}`);
}

// Which rt_camp names name-match this Meta account's campaigns via dashboard's logic?
const metaNames = meta.rows.map(r => r.campaign_name);
const matched = new Set();
for (const e of entries) {
  const rtName = e.rt_campaign || '';
  const low = rtName.toLowerCase();
  const hit = metaNames.some(m => m === rtName || (rtName.length > 10 && m.toLowerCase().includes(low)));
  if (hit) matched.add(rtName);
}
let matchedRev = 0, matchedConv = 0, matchedCount = 0;
for (const e of entries) {
  if (matched.has(e.rt_campaign)) {
    matchedRev += parseFloat(e.total_revenue||0);
    matchedConv += parseInt(e.convtype2||0,10);
    matchedCount++;
  }
}
console.log(`\nrt_camps that MATCH a Meta campaign in this account: n=${matchedCount}  rev=R$${matchedRev.toFixed(2)}  conv=${matchedConv}`);

const unmatchedSomeyum = someyumEntries.filter(e => !matched.has(e.rt_campaign));
console.log(`\nSomeYum rt_camps NOT matched to any Meta campaign (revenue invisible to dashboard): ${unmatchedSomeyum.length}`);
for (const e of unmatchedSomeyum) {
  const rev = parseFloat(e.total_revenue||0);
  if (rev > 0) console.log(`  LOST rev=R$${rev}  conv=${e.convtype2}  "${e.rt_campaign}"`);
}

// Which Meta campaigns have NO rt_camp match (from SomeYum side)?
const rtCampNames = entries.map(e => (e.rt_campaign||'').toLowerCase());
let metaUnmatched = 0, metaUnmatchedSpend = 0;
for (const m of meta.rows) {
  const ml = m.campaign_name.toLowerCase();
  const hit = rtCampNames.some(n => n === ml || (n.length > 10 && ml.includes(n)));
  if (!hit) { metaUnmatched++; metaUnmatchedSpend += parseFloat(m.spend||0); }
}
console.log(`\nMeta campaigns in SomeYum CA5 with NO rt_camp match: ${metaUnmatched} / ${meta.rows.length}  (spend USD: $${metaUnmatchedSpend.toFixed(2)})`);

await pool.end();
