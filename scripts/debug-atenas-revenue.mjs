// Replica RECEITA do /api/import e mede o vazamento por causa do merge-por-nome
// que descarta IDs adicionais (findRevenue só busca rtByMetaId pelo primeiro ID).
import pg from 'pg';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
const DATABASE_URL = env.match(/^DATABASE_URL=(.*)$/m)[1].trim();
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl:{rejectUnauthorized:false}});

const ACC = 'act_210867683874813';
const RT  = '69dea489a7fd835b5a30efe8';
const D   = '2026-04-23';

// Meta
const metaRes = await pool.query(
  `SELECT campaign_id, campaign_name, SUM(spend)::float AS spend
   FROM meta_ads_metrics WHERE account_id=$1 AND date=$2
   GROUP BY campaign_id, campaign_name`, [ACC, D]
);
const metaResults = metaRes.rows.map(r => ({...r, spend: parseFloat(r.spend)}));

// rt_camp_id (sub3 = Meta campaign_id)
const rtCampIdRows = await pool.query(
  `SELECT data FROM import_cache WHERE cache_key=$1 AND date_from=$2 AND date_to=$2`,
  [`rt_camp_id:${RT}`, D]
);
const rtByMetaId = new Map();
for (const r of rtCampIdRows.rows) for (const e of (r.data||[])) {
  if (!e.sub3) continue;
  const cur = rtByMetaId.get(e.sub3) || { rev:0, conv:0 };
  cur.rev  += parseFloat(e.total_revenue||0);
  cur.conv += parseInt(e.convtype2||0, 10);
  rtByMetaId.set(e.sub3, cur);
}
console.log(`rtByMetaId entries (Meta IDs com receita RT): ${rtByMetaId.size}`);

// rt_ads
const rtAdRows = await pool.query(
  `SELECT data FROM import_cache WHERE cache_key=$1 AND date_from=$2 AND date_to=$2`,
  [`rt_ad:${RT}`, D]
);
const rtAds = new Set();
for (const r of rtAdRows.rows) for (const e of (r.data||[])) if (e.rt_ad) rtAds.add(e.rt_ad);

// === MÉTODO 1: replica EXATO do /api/import (merge por nome, perde IDs) ===
const metaMap = new Map();
metaResults.forEach(mc => {
  const ex = metaMap.get(mc.campaign_name);
  if (ex) ex.spend += mc.spend;
  else    metaMap.set(mc.campaign_name, { ...mc });
});
const metaResultsFinal = Array.from(metaMap.values());

let revImport = 0, convImport = 0;
for (const rtAd of rtAds) {
  const escaped = rtAd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(`(?:^|[^a-zA-Z0-9_.])` + escaped + `(?:[^a-zA-Z0-9_.]|$)`, 'i');
  for (const mc of metaResultsFinal.filter(m => rx.test(m.campaign_name))) {
    const e = rtByMetaId.get(mc.campaign_id);
    if (e) { revImport += e.rev; convImport += e.conv; }
  }
}
console.log(`\n[MÉTODO ATUAL — merge por nome, lookup só no 1º ID]`);
console.log(`  Receita: R$${revImport.toFixed(2)}  |  Vendas: ${convImport}`);

// === MÉTODO 2: SEM merge por nome — itera todos os IDs ===
let revFix = 0, convFix = 0;
const seenNames = new Set();
for (const rtAd of rtAds) {
  const escaped = rtAd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(`(?:^|[^a-zA-Z0-9_.])` + escaped + `(?:[^a-zA-Z0-9_.]|$)`, 'i');
  for (const mc of metaResults.filter(m => rx.test(m.campaign_name))) {
    const e = rtByMetaId.get(mc.campaign_id);
    if (e) { revFix += e.rev; convFix += e.conv; }
  }
}
console.log(`\n[FIX — soma receita de TODOS os Meta IDs cujo nome casa]`);
console.log(`  Receita: R$${revFix.toFixed(2)}  |  Vendas: ${convFix}`);
console.log(`\n  Diferença (vazamento): +R$${(revFix-revImport).toFixed(2)}  +${convFix-convImport} vendas`);
console.log(`  Screenshot RECEITA: R$56.951,74`);

// Quantos Meta IDs (do CA01 hoje) têm receita RT mas foram descartados pelo merge?
const idsKeptByMerge = new Set(metaResultsFinal.map(m => m.campaign_id));
let lostIds = 0, lostRev = 0;
for (const mc of metaResults) {
  if (!idsKeptByMerge.has(mc.campaign_id)) {
    const e = rtByMetaId.get(mc.campaign_id);
    if (e) { lostIds++; lostRev += e.rev; }
  }
}
console.log(`\nMeta IDs com receita RT que foram DESCARTADOS pelo merge: ${lostIds} (R$${lostRev.toFixed(2)})`);

await pool.end();
