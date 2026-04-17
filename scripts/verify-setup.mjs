import pg from 'pg';
import fs from 'fs';
const DATABASE_URL = fs.readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=(.*)$/m)[1].trim();
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

const DATE = '2026-04-14';
const RT_NEEDLE = '1494';
const ACC_NEEDLE = 'SomeYum CA5';

(async () => {
  const rtCamps = await pool.query(
    `SELECT campaign_id, campaign_name, is_selected FROM redtrack_campaign_selections WHERE campaign_name ILIKE $1`,
    [`%${RT_NEEDLE}%`]
  );
  console.log('\n=== RT campaigns matching', RT_NEEDLE, '===');
  console.table(rtCamps.rows);

  const accs = await pool.query(
    `SELECT account_id, account_name, bm_id, bm_name, is_selected FROM meta_ad_accounts WHERE bm_name ILIKE $1 OR account_name ILIKE $1`,
    [`%${ACC_NEEDLE}%`]
  );
  console.log('\n=== Meta accounts matching', ACC_NEEDLE, '===');
  console.table(accs.rows);

  if (!rtCamps.rows.length || !accs.rows.length) {
    console.log('\n[!] Cannot resolve filters');
    await pool.end(); return;
  }

  const rtId = rtCamps.rows[0].campaign_id;
  const accId = accs.rows[0].account_id;
  console.log(`\n>>> Using rt_campaign_id=${rtId}, account_id=${accId}, date=${DATE}\n`);

  // --- TRUTH SOURCE 1: redtrack_metrics table (direct RT numbers per day) ---
  const rtDirect = await pool.query(
    `SELECT * FROM redtrack_metrics WHERE campaign_id=$1 AND date=$2`,
    [rtId, DATE]
  );
  console.log('=== redtrack_metrics (direct table) for today ===');
  console.table(rtDirect.rows);

  // --- TRUTH SOURCE 2: import_cache rt_camp JSON for this campaign, today ---
  const rtCampCache = await pool.query(
    `SELECT date_from, synced_at, data FROM import_cache
     WHERE cache_key = $1 AND date_from = $2 AND date_to = $2`,
    [`rt_camp:${rtId}`, DATE]
  );
  console.log('\n=== import_cache rt_camp rows ===', rtCampCache.rows.length);
  let cacheRev = 0, cacheConv = 0;
  for (const row of rtCampCache.rows) {
    console.log('  synced_at:', row.synced_at);
    for (const e of (row.data || [])) {
      cacheRev += parseFloat(e.total_revenue || '0');
      cacheConv += parseInt(e.convtype2 || '0', 10);
      console.log(`    rt_campaign="${e.rt_campaign}" total_revenue=${e.total_revenue} convtype2=${e.convtype2}`);
    }
  }
  console.log(`CACHE rt_camp totals: revenue=${cacheRev.toFixed(2)} conv=${cacheConv}`);

  // --- import_cache rt_ad for this campaign, today ---
  const rtAdCache = await pool.query(
    `SELECT data FROM import_cache
     WHERE cache_key = $1 AND date_from = $2 AND date_to = $2`,
    [`rt_ad:${rtId}`, DATE]
  );
  const rtAdSet = new Set();
  for (const row of rtAdCache.rows)
    for (const e of (row.data || []))
      if (e.rt_ad) rtAdSet.add(e.rt_ad);
  console.log('\n=== distinct rt_ads in cache for today ===', Array.from(rtAdSet));

  // --- meta_ads_metrics for this account today ---
  const meta = await pool.query(
    `SELECT campaign_id, campaign_name, SUM(spend) spend, SUM(impressions) impressions, SUM(clicks) clicks, SUM(conversions) conversions
     FROM meta_ads_metrics WHERE account_id=$1 AND date=$2
     GROUP BY campaign_id, campaign_name ORDER BY SUM(spend) DESC`,
    [accId, DATE]
  );
  console.log('\n=== meta_ads_metrics campaigns for this account today ===', meta.rows.length);
  for (const r of meta.rows) {
    console.log(`  spend=${r.spend}  impr=${r.impressions}  clicks=${r.clicks}  "${r.campaign_name}"`);
  }

  // --- simulate dashboard matching ---
  console.log('\n=== DASHBOARD MATCHING SIMULATION ===');
  const unmatchedRtAds = [];
  for (const rtAd of rtAdSet) {
    const escaped = rtAd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(`(?:^|[^a-zA-Z0-9_.])` + escaped + `(?:[^a-zA-Z0-9_.]|$)`, 'i');
    const hit = meta.rows.find(r => rx.test(r.campaign_name));
    if (!hit) unmatchedRtAds.push(rtAd);
  }
  console.log('rt_ads DROPPED (no Meta campaign matches rt_ad regex):', unmatchedRtAds);

  const rtCampNames = new Set();
  for (const row of rtCampCache.rows)
    for (const e of (row.data || []))
      if (e.rt_campaign) rtCampNames.add(e.rt_campaign);
  const unmatchedRtCamps = [];
  for (const rtName of rtCampNames) {
    const hit = meta.rows.some(r => {
      const m = r.campaign_name.toLowerCase();
      return m === rtName.toLowerCase() || (rtName.length > 10 && m.includes(rtName.toLowerCase()));
    });
    if (!hit) unmatchedRtCamps.push(rtName);
  }
  console.log('rt_camp names NOT linked to any Meta campaign (revenue lost):', unmatchedRtCamps);

  // --- reproduce dashboard totals exactly ---
  const usd = 5.5; // placeholder; exact PTAX not critical for diagnosis
  const rtCampByName = new Map();
  for (const row of rtCampCache.rows)
    for (const e of (row.data || []))
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
      convtype2: String(matches.reduce((s,c)=>s+parseInt(c.convtype2||'0',10),0)),
      total_revenue: String(matches.reduce((s,c)=>s+parseFloat(c.total_revenue||'0'),0)),
    };
  };

  let dashCost=0, dashRev=0, dashConv=0;
  for (const rtAd of rtAdSet) {
    const escaped = rtAd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(`(?:^|[^a-zA-Z0-9_.])` + escaped + `(?:[^a-zA-Z0-9_.]|$)`, 'i');
    const matching = meta.rows.filter(r => rx.test(r.campaign_name));
    if (!matching.length) continue;
    for (const mc of matching) {
      const rtCamp = findRtCamp(mc.campaign_name);
      const spendBrl = parseFloat(mc.spend) * usd;
      const rev = rtCamp ? parseFloat(rtCamp.total_revenue||'0') : 0;
      const conv = rtCamp ? parseInt(rtCamp.convtype2||'0',10) : 0;
      dashCost += spendBrl;
      dashRev += rev;
      dashConv += conv;
    }
  }

  console.log('\n=== COMPARISON ===');
  const truthRev = rtDirect.rows[0] ? parseFloat(rtDirect.rows[0].total_revenue||0) : cacheRev;
  const truthConv = rtDirect.rows[0] ? parseInt(rtDirect.rows[0].total_conversions||0) : cacheConv;
  console.log(`TRUTH (redtrack_metrics/cache): revenue=R$${truthRev.toFixed(2)}  conv=${truthConv}`);
  console.log(`DASHBOARD (reproduced):        revenue=R$${dashRev.toFixed(2)}  conv=${dashConv}  cost=R$${dashCost.toFixed(2)}`);
  console.log(`DIFF:                           revenue=R$${(truthRev-dashRev).toFixed(2)}  conv=${truthConv-dashConv}`);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
