import fs from 'fs';
const env = fs.readFileSync('.env.local', 'utf8');
const REDTRACK_API_KEY = env.match(/^REDTRACK_API_KEY=(.*)$/m)[1].trim();
const rtId = '691250b7c3f17e8305b9b82a';

const dateFrom = '2026-01-23';
const dateTo = '2026-04-23';

async function get(params) {
  const url = `https://api.redtrack.io/report?api_key=${REDTRACK_API_KEY}&date_from=${dateFrom}&date_to=${dateTo}&tz=America/Sao_Paulo&${params}&per=5000`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${params}`);
  const d = await res.json();
  return Array.isArray(d) ? d : (d.data || []);
}

// 1. Check total for the campaign
const byCamp = await get(`group=campaign&campaign_id=${rtId}`);
const target = byCamp.find(r => r.campaign_id === rtId);
console.log('Campaign grouping (filtered):');
console.log(`  total rows: ${byCamp.length}`);
if (target) console.log(`  ${target.campaign}  clicks=${target.clicks}  approved=${target.approved}  cost=${target.cost}  rev=${target.total_revenue}  roas=${target.roas}`);

// 2. Check without filter
const allCamp = await get(`group=campaign`);
const target2 = allCamp.find(r => r.campaign_id === rtId);
console.log(`\nCampaign grouping (no filter): ${allCamp.length} rows`);
if (target2) console.log(`  ${target2.campaign}  clicks=${target2.clicks}  approved=${target2.approved}  cost=${target2.cost}  rev=${target2.total_revenue}  roas=${target2.roas}`);

// 3. sub1 filtered
await new Promise(r => setTimeout(r, 1200));
const sub1Filtered = await get(`group=sub1&campaign_id=${rtId}`);
const totalClicksSub1 = sub1Filtered.reduce((a, r) => a + (r.clicks || 0), 0);
const totalCostSub1 = sub1Filtered.reduce((a, r) => a + parseFloat(r.cost || 0), 0);
console.log(`\nsub1 (filtered): ${sub1Filtered.length} rows, sum_clicks=${totalClicksSub1}, sum_cost=${totalCostSub1.toFixed(2)}`);
console.log(`  top values: ${sub1Filtered.slice(0,5).map(r => `sub1='${r.sub1}' clicks=${r.clicks}`).join(' | ')}`);

// 4. sub4 filtered
await new Promise(r => setTimeout(r, 1200));
const sub4Filtered = await get(`group=sub4&campaign_id=${rtId}`);
const totalClicksSub4 = sub4Filtered.reduce((a, r) => a + (r.clicks || 0), 0);
const totalCostSub4 = sub4Filtered.reduce((a, r) => a + parseFloat(r.cost || 0), 0);
console.log(`\nsub4 (filtered): ${sub4Filtered.length} rows, sum_clicks=${totalClicksSub4}, sum_cost=${totalCostSub4.toFixed(2)}`);

// 5. Also try tracks=ad with rt_campaign
await new Promise(r => setTimeout(r, 1200));
const url5 = `https://api.redtrack.io/campaigns?api_key=${REDTRACK_API_KEY}&id=${rtId}`;
const r5 = await fetch(url5);
const d5 = await r5.json();
console.log(`\nCampaign info:`, JSON.stringify(d5).slice(0, 1500));
