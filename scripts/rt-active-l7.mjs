import fs from 'fs';
const TMP = 'c:/Apps/REPORT/.tmp';
const dateCamp = JSON.parse(fs.readFileSync(`${TMP}/rt_by_date_fb_campaign.json`, 'utf8'));
const meta = JSON.parse(fs.readFileSync(`${TMP}/meta_top_campaigns.json`, 'utf8'));

// Aggregate dateCamp per sub3 for last 7 days (2026-04-16 .. 2026-04-22)
const L7_MIN = '2026-04-16';
const L7_MAX = '2026-04-22';
const P7_MIN = '2026-04-09';
const P7_MAX = '2026-04-15';
const L14 = {};
function agg(rows, from, to) {
  const out = {};
  for (const r of rows) {
    if (r.date < from || r.date > to) continue;
    const k = r.sub3 || '';
    if (!out[k]) out[k] = { clicks:0, approved:0, cost:0, rev:0, days:new Set() };
    out[k].clicks += r.clicks || 0;
    out[k].approved += r.approved || 0;
    out[k].cost += parseFloat(r.cost||0);
    out[k].rev += parseFloat(r.total_revenue||0);
    out[k].days.add(r.date);
  }
  return out;
}
const L7 = agg(dateCamp, L7_MIN, L7_MAX);
const P7 = agg(dateCamp, P7_MIN, P7_MAX);

const metaById = {};
for (const m of meta) metaById[m.id] = m;

// Print for campaigns that are ACTIVE in Meta
console.log('=== ACTIVE CAMPAIGNS — RedTrack L7 vs P7 ===');
console.log('Status   Name                                                   L7_spend  L7_conv  L7_ROAS  P7_spend  P7_ROAS  delta_spend%');
const activeCamps = meta.filter(m => m.effective_status === 'ACTIVE');
const rows = activeCamps.map(c => {
  const l = L7[c.id] || { cost:0, rev:0, approved:0, clicks:0, days:new Set() };
  const p = P7[c.id] || { cost:0, rev:0, approved:0, clicks:0, days:new Set() };
  return { ...c, l7_cost: l.cost, l7_rev: l.rev, l7_approved: l.approved, l7_clicks: l.clicks, l7_days: l.days.size, p7_cost: p.cost, p7_rev: p.rev, p7_approved: p.approved };
}).sort((a,b)=>b.l7_cost-a.l7_cost);

for (const r of rows) {
  const l7r = r.l7_cost>0 ? (r.l7_rev/r.l7_cost).toFixed(2) : '-';
  const p7r = r.p7_cost>0 ? (r.p7_rev/r.p7_cost).toFixed(2) : '-';
  const dSpend = r.p7_cost>0 ? ((r.l7_cost-r.p7_cost)/r.p7_cost*100).toFixed(0)+'%' : (r.l7_cost>0?'new':'0');
  const daily = r.daily_budget_brl ? `R$${r.daily_budget_brl}` : '(CBO)';
  console.log(`ACTIVE   ${(r.name||'').slice(0,56).padEnd(56)} $${r.l7_cost.toFixed(0).padStart(6)}  ${String(r.l7_approved).padStart(3)}/${String(r.l7_clicks).padStart(4)}  ${l7r.padStart(4)}  $${r.p7_cost.toFixed(0).padStart(6)}  ${p7r.padStart(4)}  ${String(dSpend).padStart(5)}  daily=${daily}`);
}

// Also print ACTIVE campaigns that spent $0 in L7 (zombie-active, still "active" but not spending)
console.log('\n=== ACTIVE BUT IDLE (active on Meta, $0 RT spend in L7) ===');
const idle = rows.filter(r => r.l7_cost === 0);
console.log(`${idle.length} idle-active campaigns`);
for (const r of idle) {
  console.log(`  ${(r.name||'').slice(0,60).padEnd(60)}  90d_spend=$${r.spend.toFixed(0).padStart(6)}  90d_ROAS=${(r.rev/r.spend).toFixed(2)}`);
}

// Now look at ALL ACTIVE sub3 from L7 (maybe some not in top-60 by lifetime)
console.log('\n=== TOP FB CAMPAIGNS BY L7 SPEND (all IDs present in RT last 7 days) ===');
const L7arr = Object.entries(L7).map(([id, v]) => ({ id, ...v, roas: v.cost>0 ? v.rev/v.cost : 0 }));
L7arr.sort((a,b)=>b.cost-a.cost);
console.log(`${L7arr.length} campaigns with L7 spend > 0`);
for (const r of L7arr.slice(0, 30)) {
  const m = metaById[r.id];
  const name = m ? m.name : '(not looked up)';
  const status = m ? (m.effective_status||'?') : '?';
  const cpa = r.approved>0 ? (r.cost/r.approved).toFixed(0) : '-';
  const cr = r.clicks>0 ? ((r.approved/r.clicks)*100).toFixed(2) : '-';
  console.log(`  ${r.id.slice(0,18).padEnd(18)} ${String(status).slice(0,7).padEnd(7)} ${name.slice(0,45).padEnd(45)} L7_spend=$${r.cost.toFixed(0).padStart(6)}  ROAS=${r.roas.toFixed(2)}  conv=${r.approved}  CPA=$${cpa}  CR=${cr}%`);
}

// Summary stats: what % of L7 spend is in ACTIVE campaigns from top-60?
const top60ActiveIds = new Set(activeCamps.map(c => c.id));
let inActiveTop60 = 0, total = 0;
for (const [id, v] of Object.entries(L7)) {
  total += v.cost;
  if (top60ActiveIds.has(id)) inActiveTop60 += v.cost;
}
console.log(`\nL7 total spend (visible in sub3 data, 1000-cap): $${total.toFixed(0)}`);
console.log(`L7 spend in top-60 ACTIVE campaigns: $${inActiveTop60.toFixed(0)} (${(inActiveTop60/total*100).toFixed(1)}%)`);
