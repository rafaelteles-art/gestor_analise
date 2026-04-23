import fs from 'fs';
import pg from 'pg';

const env = fs.readFileSync('.env.local', 'utf8');
const DATABASE_URL = env.match(/^DATABASE_URL=(.*)$/m)[1].trim();
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

const TMP = 'c:/Apps/REPORT/.tmp';
const camps = JSON.parse(fs.readFileSync(`${TMP}/lottov7_all_campaigns.json`, 'utf8'));

console.log(`Total campaigns: ${camps.length}`);

// BM-level aggregates
const byBm = {};
for (const c of camps) {
  const bm = c.bm_name || '?';
  if (!byBm[bm]) byBm[bm] = { total:0, active:0, paused:0, other:0, accounts: new Set(), active_daily_brl: 0 };
  byBm[bm].total += 1;
  byBm[bm].accounts.add(c.account_id);
  if (c.effective_status === 'ACTIVE') {
    byBm[bm].active += 1;
    if (c.daily_budget_brl) byBm[bm].active_daily_brl += c.daily_budget_brl;
  } else if (c.effective_status === 'PAUSED') byBm[bm].paused += 1;
  else byBm[bm].other += 1;
}

console.log('\n=== LOTTOV7 POR BM (ordenado por ativas) ===');
console.log('BM                                contas   camps   active   paused    CBO_daily_active');
const bmSorted = Object.entries(byBm).sort((a,b)=>b[1].active - a[1].active);
for (const [bm, v] of bmSorted) {
  if (v.total < 1) continue;
  console.log(`${bm.slice(0,35).padEnd(35)}  ${String(v.accounts.size).padStart(4)}    ${String(v.total).padStart(4)}    ${String(v.active).padStart(5)}    ${String(v.paused).padStart(5)}     R$ ${v.active_daily_brl.toFixed(0).padStart(7)}`);
}

// Type of campaign (ABO vs CBO) by name pattern
let abo=0, cbo=0, other=0, aboActive=0, cboActive=0, otherActive=0;
let aboDaily=0, cboDaily=0, otherDaily=0;
for (const c of camps) {
  const name = c.campaign_name || '';
  const isActive = c.effective_status === 'ACTIVE';
  const d = isActive && c.daily_budget_brl ? c.daily_budget_brl : 0;
  if (name.includes('ABO')) { abo++; if (isActive) { aboActive++; aboDaily+=d; } }
  else if (name.includes('CBO')) { cbo++; if (isActive) { cboActive++; cboDaily+=d; } }
  else { other++; if (isActive) { otherActive++; otherDaily+=d; } }
}
console.log('\n=== TIPO DE CAMPANHA (ABO/CBO) ===');
console.log(`ABO:   ${abo} total | ${aboActive} ativas | R$ ${aboDaily.toFixed(0)}/dia declarado CBO_on_adset (nota: ABO tem budget no adset, não na campanha — não aparece em daily_budget)`);
console.log(`CBO:   ${cbo} total | ${cboActive} ativas | R$ ${cboDaily.toFixed(0)}/dia declarado`);
console.log(`Outro: ${other} total | ${otherActive} ativas | R$ ${otherDaily.toFixed(0)}/dia declarado`);

// Top 60 active by budget (all CBO)
console.log('\n=== TOP 60 ATIVAS POR DAILY BUDGET DECLARADO ===');
const activeWithDaily = camps.filter(c => c.effective_status === 'ACTIVE' && c.daily_budget_brl).sort((a,b)=>b.daily_budget_brl - a.daily_budget_brl);
console.log('R$/dia    BM                            conta                          nome');
for (const c of activeWithDaily.slice(0,60)) {
  console.log(`R$ ${c.daily_budget_brl.toFixed(0).padStart(6)}  ${(c.bm_name||'').slice(0,28).padEnd(28)}  ${(c.account_name||'').slice(0,28).padEnd(28)}  ${c.campaign_name.slice(0,70)}`);
}

// BIDCAP CBO campaigns specifically
console.log('\n=== CAMPANHAS CBO BIDCAP ATIVAS ===');
const bidcap = camps.filter(c => c.effective_status === 'ACTIVE' && /CBO.*BIDCAP|BIDCAP.*CBO/i.test(c.campaign_name));
console.log(`Total: ${bidcap.length}`);
console.log(`Soma diária: R$ ${bidcap.reduce((s,c)=>s+(c.daily_budget_brl||0),0).toFixed(0)}`);
bidcap.sort((a,b)=>(b.daily_budget_brl||0)-(a.daily_budget_brl||0)).forEach(c => {
  console.log(`  R$ ${String(c.daily_budget_brl||0).padStart(6)}/dia  ${(c.account_name||'').slice(0,28).padEnd(28)}  ${c.campaign_name.slice(0,70)}`);
});

// Cross reference: contas com LOTTOV7 ativas que NÃO estavam nos top-60 da análise anterior
const previousTop6Accts = ['act_737119765020402','act_2415590562281299','act_936905762146055','act_993539959399880','act_1972025789955315','act_1583963688753767'];
const newAcctActive = new Map();
for (const c of camps) {
  if (c.effective_status !== 'ACTIVE') continue;
  if (previousTop6Accts.includes(c.account_id)) continue;
  if (!newAcctActive.has(c.account_id)) newAcctActive.set(c.account_id, { bm: c.bm_name, acct: c.account_name, active: 0, daily: 0 });
  const o = newAcctActive.get(c.account_id);
  o.active += 1;
  o.daily += c.daily_budget_brl || 0;
}
console.log(`\n=== CONTAS ATIVAS COM LOTTOV7 QUE ESTAVAM FORA DA ANÁLISE ANTERIOR ===`);
console.log(`Total: ${newAcctActive.size} contas`);
const newArr = [...newAcctActive.entries()].sort((a,b)=>b[1].active - a[1].active);
console.log('accountid                     BM                         conta                             active   daily_declared');
for (const [id, v] of newArr.slice(0, 40)) {
  console.log(`${id.padEnd(30)} ${(v.bm||'').slice(0,26).padEnd(26)} ${(v.acct||'').slice(0,30).padEnd(30)}  ${String(v.active).padStart(4)}    R$ ${v.daily.toFixed(0).padStart(6)}`);
}

// Look at RedTrack campaigns again for any with LOTTOV7 in name
const rtCamps = await pool.query(
  `SELECT campaign_id, campaign_name, status, is_selected FROM redtrack_campaign_selections WHERE campaign_name ILIKE '%LOTTO%' ORDER BY campaign_name`
);
console.log(`\n=== CAMPANHAS REDTRACK COM "LOTTO" NO NOME ===`);
console.log(`Total: ${rtCamps.rows.length}`);
for (const r of rtCamps.rows) {
  console.log(`  ${r.status === '1' ? 'ACT' : 'PAU'}  ${r.is_selected ? '[sel]' : '     '}  ${r.campaign_id}  ${r.campaign_name.slice(0,100)}`);
}

await pool.end();
