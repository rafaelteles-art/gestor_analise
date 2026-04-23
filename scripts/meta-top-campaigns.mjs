import fs from 'fs';
import pg from 'pg';

const env = fs.readFileSync('.env.local', 'utf8');
const META_PROFILES = JSON.parse(env.match(/^META_PROFILES='(.+)'$/m)[1]);
const DATABASE_URL = env.match(/^DATABASE_URL=(.*)$/m)[1].trim();
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

const TMP = 'c:/Apps/REPORT/.tmp';
const sub3 = JSON.parse(fs.readFileSync(`${TMP}/rt_by_fb_campaign.json`, 'utf8'));

// Get top 50 FB campaign IDs by cost
const topIds = [...sub3]
  .filter(r => parseFloat(r.cost) > 1000 && r.sub3 && /^\d+$/.test(r.sub3))
  .sort((a,b)=>parseFloat(b.cost)-parseFloat(a.cost))
  .slice(0, 60)
  .map(r => ({ id: r.sub3, spend: parseFloat(r.cost), rev: parseFloat(r.total_revenue), approved: r.approved }));

console.log(`Top ${topIds.length} FB campaigns to look up`);

// Try each profile token until we find campaign info
const results = [];
for (const { id, spend, rev, approved } of topIds) {
  let found = false;
  for (const profile of META_PROFILES) {
    try {
      const url = `https://graph.facebook.com/v19.0/${id}?fields=name,status,effective_status,daily_budget,lifetime_budget,created_time,objective,account_id&access_token=${profile.token}`;
      const res = await fetch(url);
      const d = await res.json();
      if (d.error) {
        if (d.error.code === 100 || d.error.code === 803) continue; // try next profile
      }
      if (d.id) {
        const daily = d.daily_budget ? parseInt(d.daily_budget)/100 : null;
        const life = d.lifetime_budget ? parseInt(d.lifetime_budget)/100 : null;
        results.push({ ...d, spend, rev, approved, profile: profile.name, daily_budget_brl: daily, lifetime_budget_brl: life });
        found = true;
        break;
      }
    } catch (e) {}
  }
  if (!found) results.push({ id, name: '(not found)', spend, rev, approved });
  await new Promise(r => setTimeout(r, 150));
}

fs.writeFileSync(`${TMP}/meta_top_campaigns.json`, JSON.stringify(results, null, 2));
console.log(`Saved ${results.length} campaigns to .tmp/meta_top_campaigns.json`);

// Print summary
console.log('\n=== TOP FB CAMPAIGNS WITH META METADATA ===');
console.log('status       name                                                          account          spend    rev     roas  approved daily');
for (const r of results.slice(0, 40)) {
  const roas = r.rev > 0 ? (r.rev/r.spend).toFixed(2) : '-';
  const status = (r.effective_status || r.status || '?').slice(0,10);
  const name = (r.name || '(unknown)').slice(0, 60);
  const acc = r.account_id || '-';
  console.log(`${status.padEnd(12)} ${name.padEnd(62)} ${acc.padEnd(14)}  $${r.spend.toFixed(0).padStart(6)}  $${r.rev.toFixed(0).padStart(7)}  ${roas.padStart(4)}  ${String(r.approved).padStart(4)}   ${r.daily_budget_brl || '-'}`);
}

// Group by account
console.log('\n=== BY AD ACCOUNT ===');
const byAcc = {};
for (const r of results) {
  const a = r.account_id || '-';
  if (!byAcc[a]) byAcc[a] = { spend:0, rev:0, n:0, approved:0, active:0 };
  byAcc[a].spend += r.spend;
  byAcc[a].rev += r.rev;
  byAcc[a].approved += r.approved || 0;
  byAcc[a].n += 1;
  if (r.effective_status === 'ACTIVE') byAcc[a].active += 1;
}

// Lookup account name from DB
const accRows = await pool.query(
  `SELECT account_id, account_name, account_status, bm_name FROM meta_ad_accounts WHERE account_id = ANY($1::text[])`,
  [Object.keys(byAcc).map(a => a.startsWith('act_') ? a : `act_${a}`)]
);
const accMap = {};
for (const r of accRows.rows) accMap[r.account_id.replace('act_','')] = r;

for (const [a, v] of Object.entries(byAcc).sort((x,y)=>y[1].spend-x[1].spend)) {
  const roas = v.spend > 0 ? (v.rev/v.spend).toFixed(2) : '-';
  const info = accMap[a] || {};
  console.log(`  act_${a}  ${(info.account_name||'?').slice(0,32).padEnd(32)}  ${(info.bm_name||'?').slice(0,18).padEnd(18)}  campaigns=${v.n} (active: ${v.active})  spend=$${v.spend.toFixed(0)}  rev=$${v.rev.toFixed(0)}  ROAS=${roas}  approved=${v.approved}`);
}

await pool.end();
