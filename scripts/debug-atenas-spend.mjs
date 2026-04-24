import pg from 'pg';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
const DATABASE_URL = env.match(/^DATABASE_URL=(.*)$/m)[1].trim();
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

const TODAY = process.argv[2] || '2026-04-24';

// 1. Find the Meta account
const accs = await pool.query(
  `SELECT account_id, account_name FROM meta_ad_accounts
   WHERE account_name ~* 'atenas' ORDER BY account_name`
);
console.log('Meta accounts matching "atenas":');
for (const r of accs.rows) console.log(`  ${r.account_id}  ${r.account_name}`);

// 2. Find the RT campaign
const rtcs = await pool.query(
  `SELECT campaign_id, campaign_name FROM redtrack_campaign_selections
   WHERE campaign_name ~* '1525' ORDER BY campaign_name`
);
console.log('\nRT campaigns matching "1525":');
for (const r of rtcs.rows) console.log(`  ${r.campaign_id}  ${r.campaign_name}`);

if (!accs.rows.length || !rtcs.rows.length) { await pool.end(); process.exit(0); }

const ACC_ID = accs.rows.find(r => /atenas/i.test(r.account_name))?.account_id;
const RT_ID = rtcs.rows[0].campaign_id;

console.log(`\nUsing ACC_ID=${ACC_ID}  RT_ID=${RT_ID}\n`);

// 3. Raw meta data for today
const meta = await pool.query(
  `SELECT campaign_id, campaign_name,
          SUM(spend) AS spend
   FROM meta_ads_metrics
   WHERE account_id=$1 AND date=$2
   GROUP BY campaign_id, campaign_name
   ORDER BY SUM(spend) DESC`,
  [ACC_ID, TODAY]
);
console.log(`Total Meta campaigns on ${TODAY}: ${meta.rows.length}`);
const totalSpendUsd = meta.rows.reduce((s, r) => s + parseFloat(r.spend), 0);
console.log(`Total spend (USD): $${totalSpendUsd.toFixed(2)}`);

// 4. Find duplicate names
const byName = new Map();
for (const r of meta.rows) {
  const arr = byName.get(r.campaign_name) || [];
  arr.push(r);
  byName.set(r.campaign_name, arr);
}
const dups = [...byName.entries()].filter(([_, arr]) => arr.length > 1);
console.log(`\nDuplicate campaign_names: ${dups.length}`);
for (const [name, arr] of dups.slice(0, 10)) {
  console.log(`  "${name}"`);
  for (const r of arr) console.log(`    ${r.campaign_id}  $${parseFloat(r.spend).toFixed(2)}`);
}

// 5. rt_ad matches for RT_ID/today
const rtAdRow = await pool.query(
  `SELECT data FROM import_cache WHERE cache_key=$1 AND date_from=$2 AND date_to=$2`,
  [`rt_ad:${RT_ID}`, TODAY]
);
const rtAds = new Set();
for (const r of rtAdRow.rows) for (const e of (r.data||[])) if (e.rt_ad) rtAds.add(e.rt_ad);
console.log(`\nrt_ads in cache for ${RT_ID} on ${TODAY}: ${rtAds.size}`);

// 6. Replicate the import-route join: which rt_ads match which Meta campaigns?
//    AND spot double-counting where multiple rt_ads match the same Meta campaign.
const metaToRtAds = new Map();
let totalCostSummed = 0;
const usd = 5.5;
for (const rtAd of rtAds) {
  const escaped = rtAd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(`(?:^|[^a-zA-Z0-9_.])` + escaped + `(?:[^a-zA-Z0-9_.]|$)`, 'i');
  for (const r of meta.rows) {
    if (rx.test(r.campaign_name)) {
      const arr = metaToRtAds.get(r.campaign_id) || [];
      arr.push(rtAd);
      metaToRtAds.set(r.campaign_id, arr);
      totalCostSummed += parseFloat(r.spend) * usd;
    }
  }
}
console.log(`\nTotal cost summed by import-route logic (BRL @ ${usd}): R$${totalCostSummed.toFixed(2)}`);

const doubleMatched = [...metaToRtAds.entries()].filter(([_, arr]) => arr.length > 1);
console.log(`\nMeta campaigns matched by MULTIPLE rt_ads (= double-counted spend): ${doubleMatched.length}`);
for (const [campId, ads] of doubleMatched.slice(0, 15)) {
  const meta_row = meta.rows.find(r => r.campaign_id === campId);
  console.log(`  ${campId}  $${parseFloat(meta_row.spend).toFixed(2)}  matched by ${ads.length} rt_ads:`);
  for (const a of ads) console.log(`    - ${a}`);
  console.log(`    Meta name: ${meta_row.campaign_name}`);
}

await pool.end();
