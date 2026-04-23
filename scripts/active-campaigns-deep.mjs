import fs from 'fs';
const env = fs.readFileSync('.env.local', 'utf8');
const META_PROFILES = JSON.parse(env.match(/^META_PROFILES='(.+)'$/m)[1]);
const TMP = 'c:/Apps/REPORT/.tmp';
const meta = JSON.parse(fs.readFileSync(`${TMP}/meta_top_campaigns.json`, 'utf8'));

// Subset: ACTIVE
const activeCamps = meta.filter(r => r.effective_status === 'ACTIVE');
console.log(`\n=== ${activeCamps.length} ACTIVE campaigns (top-60 spending) ===`);

// Get Meta insights for last 7 days for each ACTIVE campaign
async function getInsight(campId, profile, days=7) {
  const until = new Date(); until.setUTCDate(until.getUTCDate()-1); // yesterday
  const since = new Date(until); since.setUTCDate(since.getUTCDate() - (days-1));
  const fmt = d => d.toISOString().slice(0,10);
  const fields = 'campaign_name,spend,impressions,clicks,actions,cpm,ctr,cpc,frequency,reach';
  const url = `https://graph.facebook.com/v19.0/${campId}/insights?fields=${fields}&time_range={'since':'${fmt(since)}','until':'${fmt(until)}'}&access_token=${profile.token}`;
  const res = await fetch(url);
  const d = await res.json();
  if (d.error) return null;
  return d.data?.[0] || null;
}

async function getCampStructure(campId, profile) {
  // How many adsets + how many ads (total + active)
  const url1 = `https://graph.facebook.com/v19.0/${campId}/adsets?fields=id,effective_status,daily_budget,lifetime_budget&limit=50&access_token=${profile.token}`;
  const r1 = await fetch(url1);
  const d1 = await r1.json();
  const adsets = d1.data || [];
  const activeAdsets = adsets.filter(a => a.effective_status === 'ACTIVE');

  // Sum daily budget
  const totalDaily = adsets.reduce((s, a) => s + (parseInt(a.daily_budget||0) / 100), 0);
  const activeDaily = activeAdsets.reduce((s, a) => s + (parseInt(a.daily_budget||0) / 100), 0);

  const url2 = `https://graph.facebook.com/v19.0/${campId}/ads?fields=id,effective_status&limit=200&access_token=${profile.token}`;
  const r2 = await fetch(url2);
  const d2 = await r2.json();
  const ads = d2.data || [];
  const activeAds = ads.filter(a => a.effective_status === 'ACTIVE');
  return { adsets_total: adsets.length, adsets_active: activeAdsets.length, ads_total: ads.length, ads_active: activeAds.length, daily_total_brl: totalDaily, daily_active_brl: activeDaily };
}

const rows = [];
for (const c of activeCamps) {
  const profile = META_PROFILES.find(p => p.name === c.profile);
  const ins = await getInsight(c.id, profile, 7);
  const struct = await getCampStructure(c.id, profile);
  const last7Spend = ins ? parseFloat(ins.spend||0) : 0;
  const last7Purchase = ins?.actions?.find(a => a.action_type === 'purchase' || a.action_type === 'lead')?.value || 0;
  rows.push({ ...c, ...struct, last7_spend: last7Spend, last7_purchase: parseInt(last7Purchase), last7_clicks: parseInt(ins?.clicks||0), last7_impressions: parseInt(ins?.impressions||0), last7_ctr: parseFloat(ins?.ctr||0), last7_cpc: parseFloat(ins?.cpc||0), last7_freq: parseFloat(ins?.frequency||0) });
  await new Promise(r => setTimeout(r, 200));
}

fs.writeFileSync(`${TMP}/meta_active_deep.json`, JSON.stringify(rows, null, 2));

console.log('\n=== ACTIVE CAMPAIGNS — LAST 7 DAYS + STRUCTURE ===');
console.log('name                                                 daily$   adsets  ads      L7_spend  L7_clicks  CTR%   freq   CPC$   90d_spend  90d_ROAS');
for (const r of rows.sort((a,b)=>b.last7_spend-a.last7_spend)) {
  const roas90 = (r.rev/r.spend).toFixed(2);
  const dailyTxt = r.daily_active_brl > 0 ? `R$${r.daily_active_brl.toFixed(0)}` : (r.daily_budget_brl ? `R$${r.daily_budget_brl}` : 'CBO');
  console.log(`${(r.name||'').slice(0,50).padEnd(50)} ${dailyTxt.padEnd(7)} ${String(r.adsets_active+'/'+r.adsets_total).padEnd(7)} ${String(r.ads_active+'/'+r.ads_total).padEnd(8)} $${r.last7_spend.toFixed(0).padStart(6)}   ${String(r.last7_clicks).padStart(5)}    ${r.last7_ctr.toFixed(2).padStart(5)}  ${r.last7_freq.toFixed(2).padStart(4)}  $${r.last7_cpc.toFixed(2).padStart(5)}  $${r.spend.toFixed(0).padStart(6)}     ${roas90}`);
}

// Count totals
const totalL7 = rows.reduce((s,r)=>s+r.last7_spend, 0);
const totalDaily = rows.reduce((s,r)=>s+r.daily_active_brl, 0);
const totalAdsetsActive = rows.reduce((s,r)=>s+r.adsets_active, 0);
const totalAdsActive = rows.reduce((s,r)=>s+r.ads_active, 0);
console.log(`\nActive campaigns in top-60: ${rows.length}`);
console.log(`  Sum L7 spend: $${totalL7.toFixed(0)}`);
console.log(`  Sum active daily budget (ABO only): R$${totalDaily.toFixed(0)}`);
console.log(`  Sum active adsets: ${totalAdsetsActive}`);
console.log(`  Sum active ads: ${totalAdsActive}`);
