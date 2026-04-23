import fs from 'fs';

const TMP = 'c:/Apps/REPORT/.tmp';
const load = (f) => JSON.parse(fs.readFileSync(`${TMP}/rt_${f}.json`, 'utf8'));

// Campaign totals
const [campTotal] = load('by_campaign');
console.log('=== CAMPAIGN TOTAL (3 months) ===');
console.log(`Name: ${campTotal.campaign}`);
console.log(`Clicks: ${campTotal.clicks.toLocaleString()}`);
console.log(`Approved conv: ${campTotal.approved.toLocaleString()}`);
console.log(`Cost: $${parseFloat(campTotal.cost).toLocaleString(undefined, {minimumFractionDigits:2,maximumFractionDigits:2})}`);
console.log(`Revenue: $${parseFloat(campTotal.total_revenue).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`);
console.log(`Profit: $${parseFloat(campTotal.profit).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`);
console.log(`ROAS: ${parseFloat(campTotal.roas).toFixed(4)}`);
console.log(`CR (approved): ${(campTotal.approved_cr*100).toFixed(2)}%`);
console.log(`EPC: $${campTotal.epc || (campTotal.total_revenue/campTotal.clicks).toFixed(4)}`);
console.log(`CPC: $${(campTotal.cost/campTotal.clicks).toFixed(4)}`);
console.log(`AOV: $${campTotal.aov}`);

// Helper to summarize a grouping
function summarize(name, rows, keyField, top = 15) {
  console.log(`\n=== ${name.toUpperCase()} — top ${top} by cost ===`);
  const sorted = [...rows].filter(r => parseFloat(r.cost || 0) > 0).sort((a, b) => parseFloat(b.cost) - parseFloat(a.cost));
  const sumClicks = rows.reduce((a, r) => a + (r.clicks || 0), 0);
  const sumCost = rows.reduce((a, r) => a + parseFloat(r.cost || 0), 0);
  const sumRev = rows.reduce((a, r) => a + parseFloat(r.total_revenue || 0), 0);
  const sumApproved = rows.reduce((a, r) => a + (r.approved || 0), 0);
  console.log(`Coverage: clicks=${sumClicks.toLocaleString()} (${((sumClicks/campTotal.clicks)*100).toFixed(1)}%), cost=$${sumCost.toLocaleString()} (${((sumCost/campTotal.cost)*100).toFixed(1)}%), rev=$${sumRev.toLocaleString()}, approved=${sumApproved.toLocaleString()}`);
  console.log(`  (${rows.length} rows total; showing top ${top} with cost>0)`);
  for (const r of sorted.slice(0, top)) {
    const roas = (parseFloat(r.total_revenue || 0) / parseFloat(r.cost || 1)).toFixed(2);
    const cr = ((r.approved || 0) / (r.clicks || 1) * 100).toFixed(2);
    const cpa = r.approved ? (parseFloat(r.cost) / r.approved).toFixed(2) : 'n/a';
    console.log(`  ${String(r[keyField] || '').slice(0,60).padEnd(60)} | clicks=${String(r.clicks||0).padStart(6)} | approved=${String(r.approved||0).padStart(4)} | cost=$${parseFloat(r.cost||0).toFixed(0).padStart(7)} | rev=$${parseFloat(r.total_revenue||0).toFixed(0).padStart(7)} | ROAS=${roas.padStart(5)} | CR=${cr.padStart(5)}% | CPA=$${cpa.padStart(6)}`);
  }
}

const sub3 = load('by_fb_campaign'); // FB campaign IDs
const sub2 = load('by_fb_adset');    // FB adset IDs
const sub1 = load('by_fb_ad');       // FB ad IDs
const sub4 = load('by_rt_ad_name');  // rt ad names
const sub5 = load('by_adset_name');
const sub6 = load('by_campaign_name');
const sub7 = load('by_placement');
const sub8 = load('by_site_source');
const date = load('by_date');

summarize('FB Campaign (sub3=campaign.id)', sub3, 'sub3', 20);
summarize('FB AdSet (sub2=adset.id)', sub2, 'sub2', 15);
summarize('rt_ad name (sub4)', sub4, 'sub4', 20);
summarize('FB AdSet name (sub5)', sub5, 'sub5', 15);
summarize('FB Campaign name (sub6)', sub6, 'sub6', 20);
summarize('Placement (sub7)', sub7, 'sub7', 27);
summarize('Site source (sub8)', sub8, 'sub8', 9);

// Date time series
console.log('\n=== DAILY TIME SERIES (last 30 days) ===');
const sortedDate = [...date].sort((a, b) => a.date.localeCompare(b.date));
console.log('date        clicks   approved  cost       rev       roas   cr%   cpa');
for (const r of sortedDate.slice(-30)) {
  const roas = (parseFloat(r.total_revenue || 0) / parseFloat(r.cost || 1)).toFixed(2);
  const cr = ((r.approved || 0) / (r.clicks || 1) * 100).toFixed(2);
  const cpa = r.approved ? (parseFloat(r.cost) / r.approved).toFixed(0) : 'n/a';
  console.log(`${r.date}  ${String(r.clicks).padStart(6)}  ${String(r.approved).padStart(6)}   $${parseFloat(r.cost).toFixed(0).padStart(6)}   $${parseFloat(r.total_revenue).toFixed(0).padStart(6)}  ${roas.padStart(4)}  ${cr.padStart(5)}  $${cpa.padStart(4)}`);
}

// Compute day-of-week performance
console.log('\n=== DAY OF WEEK ===');
const dow = [0,0,0,0,0,0,0].map(_ => ({ clicks:0, approved:0, cost:0, rev:0, days:0 }));
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
for (const r of date) {
  const d = new Date(r.date).getUTCDay();
  dow[d].clicks += r.clicks || 0;
  dow[d].approved += r.approved || 0;
  dow[d].cost += parseFloat(r.cost || 0);
  dow[d].rev += parseFloat(r.total_revenue || 0);
  dow[d].days += 1;
}
console.log('day    clicks   approved  cost       rev        roas    cr%    cpa');
for (let i = 0; i < 7; i++) {
  const x = dow[i];
  const roas = x.cost > 0 ? (x.rev/x.cost).toFixed(2) : '-';
  const cr = x.clicks > 0 ? ((x.approved/x.clicks)*100).toFixed(2) : '-';
  const cpa = x.approved > 0 ? (x.cost/x.approved).toFixed(0) : '-';
  console.log(`${DAY_NAMES[i]}    ${String(x.clicks).padStart(6)}   ${String(x.approved).padStart(4)}    $${x.cost.toFixed(0).padStart(7)}   $${x.rev.toFixed(0).padStart(7)}   ${roas.padStart(5)}  ${cr.padStart(5)}  $${cpa.padStart(4)}`);
}

// Weekly trend
console.log('\n=== WEEKLY TREND ===');
const weeks = {};
for (const r of sortedDate) {
  const d = new Date(r.date);
  const weekStart = new Date(d);
  weekStart.setUTCDate(d.getUTCDate() - d.getUTCDay());
  const key = weekStart.toISOString().slice(0,10);
  if (!weeks[key]) weeks[key] = { clicks:0, approved:0, cost:0, rev:0, days:0 };
  weeks[key].clicks += r.clicks || 0;
  weeks[key].approved += r.approved || 0;
  weeks[key].cost += parseFloat(r.cost || 0);
  weeks[key].rev += parseFloat(r.total_revenue || 0);
  weeks[key].days += 1;
}
console.log('week start   days  clicks   approved  cost       rev        roas');
for (const k of Object.keys(weeks).sort()) {
  const w = weeks[k];
  const roas = w.cost > 0 ? (w.rev/w.cost).toFixed(2) : '-';
  console.log(`${k}   ${w.days}/7   ${String(w.clicks).padStart(6)}   ${String(w.approved).padStart(4)}    $${w.cost.toFixed(0).padStart(7)}   $${w.rev.toFixed(0).padStart(7)}   ${roas.padStart(5)}`);
}
