import fs from 'fs';

const TMP = 'c:/Apps/REPORT/.tmp';
const load = (f) => JSON.parse(fs.readFileSync(`${TMP}/rt_${f}.json`, 'utf8'));

const [campTotal] = load('by_campaign');
const date = load('by_date');
const sub3 = load('by_fb_campaign');
const sub4 = load('by_rt_ad_name');
const sub5 = load('by_adset_name');
const sub6 = load('by_campaign_name');
const sub7 = load('by_placement');
const datePlace = load('by_date_placement');
const dateCamp = load('by_date_fb_campaign');

// === LAST 7 DAYS vs PRIOR 7 DAYS vs PRIOR 30 ===
console.log('=== MOMENTUM COMPARISON ===');
const sorted = [...date].sort((a,b) => a.date.localeCompare(b.date));
function sumRange(rows) {
  return rows.reduce((acc, r) => ({
    clicks: acc.clicks + (r.clicks||0),
    approved: acc.approved + (r.approved||0),
    cost: acc.cost + parseFloat(r.cost||0),
    rev: acc.rev + parseFloat(r.total_revenue||0),
  }), { clicks:0, approved:0, cost:0, rev:0 });
}
function print(label, s, days) {
  const roas = s.cost>0 ? (s.rev/s.cost).toFixed(3) : '-';
  const cr = s.clicks>0 ? ((s.approved/s.clicks)*100).toFixed(2) : '-';
  const cpa = s.approved>0 ? (s.cost/s.approved).toFixed(0) : '-';
  const avgSpend = (s.cost/days).toFixed(0);
  const avgConv = (s.approved/days).toFixed(0);
  console.log(`${label.padEnd(22)} days=${days}  spend/d=$${avgSpend.padStart(6)}  conv/d=${avgConv.padStart(3)}  ROAS=${roas}  CR=${cr}%  CPA=$${cpa}  total_spend=$${s.cost.toFixed(0)}  total_rev=$${s.rev.toFixed(0)}`);
}
// Skip today (partial day 2026-04-23 with only 1948 clicks)
const completeDays = sorted.filter(r => r.date !== '2026-04-23');
const L7 = completeDays.slice(-7);
const P7 = completeDays.slice(-14, -7);
const L14 = completeDays.slice(-14);
const L30 = completeDays.slice(-30);
const L60 = completeDays.slice(-60);
const L90 = completeDays;
print('Last 7 days', sumRange(L7), L7.length);
print('Prior 7 days', sumRange(P7), P7.length);
print('Last 14 days', sumRange(L14), L14.length);
print('Last 30 days', sumRange(L30), L30.length);
print('Last 60 days', sumRange(L60), L60.length);
print('Last 90 days', sumRange(L90), L90.length);

// Delta
const a = sumRange(L7), b = sumRange(P7);
console.log('\nWoW deltas (L7 vs P7):');
console.log(`  Spend: ${(a.cost - b.cost >=0?'+':'')}${((a.cost - b.cost)/b.cost*100).toFixed(1)}%`);
console.log(`  Approved conv: ${((a.approved - b.approved)/b.approved*100).toFixed(1)}%`);
console.log(`  Revenue: ${((a.rev - b.rev)/b.rev*100).toFixed(1)}%`);
console.log(`  ROAS: ${(a.rev/a.cost).toFixed(3)} vs ${(b.rev/b.cost).toFixed(3)} (${((a.rev/a.cost)-(b.rev/b.cost) >= 0?'+':'')}${(((a.rev/a.cost)-(b.rev/b.cost))*100).toFixed(1)}pp)`);
console.log(`  CR: ${((a.approved/a.clicks)*100).toFixed(2)}% vs ${((b.approved/b.clicks)*100).toFixed(2)}%`);
console.log(`  CPA: $${(a.cost/a.approved).toFixed(0)} vs $${(b.cost/b.approved).toFixed(0)}`);

// === PLACEMENT: last 7 days ===
console.log('\n=== PLACEMENT (last 7 days, date >= 2026-04-15) ===');
const cutoff = '2026-04-15';
const recentPlace = datePlace.filter(r => r.date >= cutoff && r.date <= '2026-04-22');
const byPlace = {};
for (const r of recentPlace) {
  const k = r.sub7 || '(empty)';
  if (!byPlace[k]) byPlace[k] = { clicks:0, approved:0, cost:0, rev:0 };
  byPlace[k].clicks += r.clicks || 0;
  byPlace[k].approved += r.approved || 0;
  byPlace[k].cost += parseFloat(r.cost||0);
  byPlace[k].rev += parseFloat(r.total_revenue||0);
}
const placeArr = Object.entries(byPlace).sort((a,b) => b[1].cost - a[1].cost);
console.log('placement              clicks   approved  cost      rev       roas   cr%   cpa');
for (const [k, v] of placeArr) {
  if (v.cost < 10) continue;
  const roas = (v.rev / v.cost).toFixed(2);
  const cr = v.clicks > 0 ? ((v.approved/v.clicks)*100).toFixed(2) : '-';
  const cpa = v.approved > 0 ? (v.cost/v.approved).toFixed(0) : '-';
  console.log(`${k.slice(0,22).padEnd(22)} ${String(v.clicks).padStart(6)}  ${String(v.approved).padStart(6)}   $${v.cost.toFixed(0).padStart(7)}  $${v.rev.toFixed(0).padStart(7)}  ${roas.padStart(5)}  ${cr.padStart(5)}  $${cpa.padStart(4)}`);
}

// === PLACEMENT: EARLY vs LATE (first 30 days vs last 30 days)
console.log('\n=== PLACEMENT TREND (first 30d vs last 30d) ===');
const first30Cut = sorted[30]?.date; // first 30 days cutoff
function aggPlace(dateFilter) {
  const out = {};
  for (const r of datePlace) {
    if (!dateFilter(r.date)) continue;
    const k = r.sub7 || '(empty)';
    if (!out[k]) out[k] = { clicks:0, approved:0, cost:0, rev:0 };
    out[k].clicks += r.clicks || 0;
    out[k].approved += r.approved || 0;
    out[k].cost += parseFloat(r.cost||0);
    out[k].rev += parseFloat(r.total_revenue||0);
  }
  return out;
}
const earliest = sorted[0].date;
const latest = completeDays[completeDays.length-1].date;
function addDays(iso, n) {
  const d = new Date(iso); d.setUTCDate(d.getUTCDate()+n);
  return d.toISOString().slice(0,10);
}
const first30Cutoff = addDays(earliest, 30);
const last30Cutoff = addDays(latest, -30);
const first30 = aggPlace(d => d < first30Cutoff);
const last30 = aggPlace(d => d >= last30Cutoff);
console.log(`(first 30d: ${earliest} .. ${addDays(first30Cutoff,-1)})  |  (last 30d: ${last30Cutoff} .. ${latest})`);
console.log('placement              first_cost  first_ROAS  last_cost  last_ROAS  spend_delta  ROAS_delta');
const allPlacements = new Set([...Object.keys(first30), ...Object.keys(last30)]);
const sortedPlacements = [...allPlacements].sort((a, b) => (last30[b]?.cost || 0) - (last30[a]?.cost || 0));
for (const p of sortedPlacements) {
  const f = first30[p] || { cost:0, rev:0 };
  const l = last30[p] || { cost:0, rev:0 };
  if (f.cost < 10 && l.cost < 10) continue;
  const fRoas = f.cost > 0 ? (f.rev/f.cost).toFixed(2) : '-';
  const lRoas = l.cost > 0 ? (l.rev/l.cost).toFixed(2) : '-';
  const spendD = f.cost>0 ? (((l.cost-f.cost)/f.cost)*100).toFixed(0)+'%' : 'new';
  const roasD = (f.cost>0 && l.cost>0) ? ((l.rev/l.cost)-(f.rev/f.cost)).toFixed(2) : '-';
  console.log(`${p.slice(0,22).padEnd(22)} $${f.cost.toFixed(0).padStart(8)}  ${String(fRoas).padStart(5)}       $${l.cost.toFixed(0).padStart(8)}  ${String(lRoas).padStart(5)}    ${String(spendD).padStart(7)}    ${String(roasD).padStart(6)}`);
}

// === ACTIVE VS. ZOMBIE ADS (spent but no approved conversions) ===
console.log('\n=== ZOMBIE rt_ads (spend > $500, 0 approved conv over 90d) ===');
const zombies = sub4.filter(r => parseFloat(r.cost) > 500 && (r.approved||0) === 0);
console.log(`${zombies.length} zombies`);
zombies.sort((a,b)=>parseFloat(b.cost)-parseFloat(a.cost)).slice(0,20).forEach(r => {
  console.log(`  ${String(r.sub4).padEnd(30)}  cost=$${parseFloat(r.cost).toFixed(0).padStart(6)}  clicks=${r.clicks}`);
});

// === LOSERS: ads with decent spend but low ROAS
console.log('\n=== LOSING rt_ads (spend > $10k, ROAS < 1.5) ===');
const losers = sub4.filter(r => parseFloat(r.cost) > 10000 && (parseFloat(r.total_revenue)/parseFloat(r.cost)) < 1.5);
losers.sort((a,b)=>parseFloat(b.cost)-parseFloat(a.cost));
console.log(`${losers.length} losing rt_ads represent $${losers.reduce((s,r)=>s+parseFloat(r.cost),0).toFixed(0)} cost`);
losers.slice(0,25).forEach(r => {
  const roas = (parseFloat(r.total_revenue)/parseFloat(r.cost)).toFixed(2);
  const cr = ((r.approved||0)/(r.clicks||1)*100).toFixed(2);
  console.log(`  ${String(r.sub4).padEnd(30)}  cost=$${parseFloat(r.cost).toFixed(0).padStart(7)}  rev=$${parseFloat(r.total_revenue).toFixed(0).padStart(7)}  ROAS=${roas}  CR=${cr}%  approved=${r.approved}`);
});

// === WINNERS: ads with decent spend and high ROAS
console.log('\n=== WINNING rt_ads (spend > $20k, ROAS >= 2.0) ===');
const winners = sub4.filter(r => parseFloat(r.cost) > 20000 && (parseFloat(r.total_revenue)/parseFloat(r.cost)) >= 2.0);
winners.sort((a,b)=>(parseFloat(b.total_revenue)/parseFloat(b.cost))-(parseFloat(a.total_revenue)/parseFloat(a.cost)));
console.log(`${winners.length} winning rt_ads represent $${winners.reduce((s,r)=>s+parseFloat(r.cost),0).toFixed(0)} cost, $${winners.reduce((s,r)=>s+parseFloat(r.total_revenue),0).toFixed(0)} revenue`);
winners.slice(0,25).forEach(r => {
  const roas = (parseFloat(r.total_revenue)/parseFloat(r.cost)).toFixed(2);
  const cr = ((r.approved||0)/(r.clicks||1)*100).toFixed(2);
  console.log(`  ${String(r.sub4).padEnd(30)}  cost=$${parseFloat(r.cost).toFixed(0).padStart(7)}  rev=$${parseFloat(r.total_revenue).toFixed(0).padStart(7)}  ROAS=${roas}  CR=${cr}%  approved=${r.approved}`);
});

// === FB CAMPAIGN NAMES — concentration analysis (Pareto)
console.log('\n=== FB CAMPAIGN NAME PARETO ===');
const names = [...sub6].filter(r => parseFloat(r.cost) > 0).sort((a,b) => parseFloat(b.cost) - parseFloat(a.cost));
let cum = 0;
const total = parseFloat(campTotal.cost);
const marks = [0.5, 0.8, 0.9, 0.95];
let markIdx = 0;
for (let i = 0; i < names.length; i++) {
  cum += parseFloat(names[i].cost);
  while (markIdx < marks.length && cum / total >= marks[markIdx]) {
    console.log(`  ${(marks[markIdx]*100).toFixed(0)}% of total spend ($${cum.toFixed(0)}) comes from top ${i+1} campaigns (out of ${names.length})`);
    markIdx++;
  }
}

// === AD PERFORMANCE CONCENTRATION ===
console.log('\n=== RT_AD PARETO (sub4) ===');
const ads = [...sub4].filter(r => parseFloat(r.cost) > 0).sort((a,b) => parseFloat(b.cost) - parseFloat(a.cost));
cum = 0;
markIdx = 0;
const adsSumCost = ads.reduce((s,r)=>s+parseFloat(r.cost),0);
for (let i = 0; i < ads.length; i++) {
  cum += parseFloat(ads[i].cost);
  while (markIdx < marks.length && cum / adsSumCost >= marks[markIdx]) {
    console.log(`  ${(marks[markIdx]*100).toFixed(0)}% of ad spend ($${cum.toFixed(0)}) from top ${i+1} rt_ads (out of ${ads.length} with cost>0)`);
    markIdx++;
  }
}

// === Overall weekly cadence + spend
const weeks = {};
for (const r of sorted) {
  const d = new Date(r.date);
  const weekStart = new Date(d);
  weekStart.setUTCDate(d.getUTCDate() - d.getUTCDay());
  const key = weekStart.toISOString().slice(0,10);
  if (!weeks[key]) weeks[key] = { clicks:0, approved:0, cost:0, rev:0 };
  weeks[key].clicks += r.clicks || 0;
  weeks[key].approved += r.approved || 0;
  weeks[key].cost += parseFloat(r.cost || 0);
  weeks[key].rev += parseFloat(r.total_revenue || 0);
}
