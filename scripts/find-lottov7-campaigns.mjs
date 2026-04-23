import fs from 'fs';
import pg from 'pg';

const env = fs.readFileSync('.env.local', 'utf8');
const META_PROFILES = JSON.parse(env.match(/^META_PROFILES='(.+)'$/m)[1]);
const DATABASE_URL = env.match(/^DATABASE_URL=(.*)$/m)[1].trim();
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

const TMP = 'c:/Apps/REPORT/.tmp';
const API_VERSION = 'v19.0';

// Pull all Meta ad accounts from DB
const accRes = await pool.query(
  `SELECT account_id, account_name, bm_id, bm_name, access_token, account_status, perfil
   FROM meta_ad_accounts
   WHERE access_token IS NOT NULL
   ORDER BY bm_name, account_name`
);

const accounts = accRes.rows;
console.log(`Total accounts with token: ${accounts.length}`);

// For each account, try to fetch campaigns with "LOTTOV7" in name
const foundCampaigns = [];
const accountsWithLottoV7 = new Set();
const failedAccounts = [];
let progress = 0;

async function fetchCampaignsForAccount(account) {
  const { account_id, access_token } = account;
  // filtering?filtering=[{"field":"name","operator":"CONTAIN","value":"LOTTOV7"}] — Graph supports this
  const filterArg = encodeURIComponent(JSON.stringify([{ field: 'name', operator: 'CONTAIN', value: 'LOTTOV7' }]));
  const fields = 'id,name,status,effective_status,daily_budget,lifetime_budget,objective,created_time,updated_time';
  let url = `https://graph.facebook.com/${API_VERSION}/${account_id}/campaigns?fields=${fields}&filtering=${filterArg}&limit=200&access_token=${access_token}`;
  const results = [];
  let pages = 0;
  while (url && pages < 10) {
    let res;
    try {
      res = await fetch(url);
    } catch (e) { return { ok: false, err: 'network: '+e.message, results }; }
    const d = await res.json();
    if (d.error) {
      return { ok: false, err: `${d.error.code}:${d.error.message.slice(0,80)}`, results };
    }
    if (d.data) results.push(...d.data);
    url = d.paging?.next || null;
    pages++;
  }
  return { ok: true, results };
}

for (const account of accounts) {
  progress++;
  if (progress % 20 === 0) console.log(`  [${progress}/${accounts.length}] ...`);
  const { ok, results, err } = await fetchCampaignsForAccount(account);
  if (!ok) {
    failedAccounts.push({ account_id: account.account_id, account_name: account.account_name, bm_name: account.bm_name, err });
    continue;
  }
  if (results.length) {
    accountsWithLottoV7.add(account.account_id);
    for (const camp of results) {
      const daily = camp.daily_budget ? parseInt(camp.daily_budget)/100 : null;
      const life = camp.lifetime_budget ? parseInt(camp.lifetime_budget)/100 : null;
      foundCampaigns.push({
        account_id: account.account_id,
        account_name: account.account_name,
        bm_name: account.bm_name,
        perfil: account.perfil,
        campaign_id: camp.id,
        campaign_name: camp.name,
        status: camp.status,
        effective_status: camp.effective_status,
        daily_budget_brl: daily,
        lifetime_budget_brl: life,
        objective: camp.objective,
        created_time: camp.created_time,
        updated_time: camp.updated_time,
      });
    }
  }
  await new Promise(r => setTimeout(r, 60));
}

fs.writeFileSync(`${TMP}/lottov7_all_campaigns.json`, JSON.stringify(foundCampaigns, null, 2));
fs.writeFileSync(`${TMP}/lottov7_failed_accounts.json`, JSON.stringify(failedAccounts, null, 2));

console.log(`\n✅ Busca concluída`);
console.log(`  Contas varridas: ${accounts.length}`);
console.log(`  Falhas (token ruim / sem permissão): ${failedAccounts.length}`);
console.log(`  Contas com LOTTOV7: ${accountsWithLottoV7.size}`);
console.log(`  Campanhas LOTTOV7 encontradas: ${foundCampaigns.length}`);

// Breakdown por conta
console.log('\n=== CAMPANHAS LOTTOV7 POR CONTA ===');
const perAcc = {};
for (const c of foundCampaigns) {
  if (!perAcc[c.account_id]) perAcc[c.account_id] = { account_name: c.account_name, bm_name: c.bm_name, perfil: c.perfil, total: 0, active: 0, paused: 0 };
  perAcc[c.account_id].total += 1;
  if (c.effective_status === 'ACTIVE') perAcc[c.account_id].active += 1;
  else if (c.effective_status === 'PAUSED') perAcc[c.account_id].paused += 1;
}
const perAccSorted = Object.entries(perAcc).sort((a,b) => b[1].active - a[1].active || b[1].total - a[1].total);
console.log('account_id                    bm                       nome_conta                      perfil  total  active  paused');
for (const [id, v] of perAccSorted) {
  console.log(`${id.padEnd(30)} ${(v.bm_name||'').slice(0,22).padEnd(22)} ${(v.account_name||'').slice(0,30).padEnd(30)} ${(v.perfil||'-').padEnd(7)}  ${String(v.total).padStart(4)}   ${String(v.active).padStart(5)}   ${String(v.paused).padStart(5)}`);
}

console.log('\n=== RESUMO CAMPANHAS ATIVAS ===');
const activeCamps = foundCampaigns.filter(c => c.effective_status === 'ACTIVE');
console.log(`Total ativas: ${activeCamps.length}`);

// Active campaigns daily budget
const totalDailyBrlActive = activeCamps.reduce((s, c) => s + (c.daily_budget_brl || 0), 0);
console.log(`Soma de daily_budget declarado em campanhas ativas (CBO): R$ ${totalDailyBrlActive.toFixed(0)}`);

console.log('\nTop 30 ativas por daily_budget (quando CBO):');
activeCamps
  .filter(c => c.daily_budget_brl)
  .sort((a,b)=>b.daily_budget_brl-a.daily_budget_brl)
  .slice(0,30)
  .forEach(c => console.log(`  R$${c.daily_budget_brl.toFixed(0).padStart(6)}/dia  ${c.effective_status}  ${(c.account_name||'').slice(0,22).padEnd(22)}  ${c.campaign_name.slice(0,60)}`));

await pool.end();
