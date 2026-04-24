// Replica EXATAMENTE a lógica da rota /api/import para CA01-Atenas + RT 1525
// e identifica onde o GASTO diverge.
import pg from 'pg';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
const DATABASE_URL = env.match(/^DATABASE_URL=(.*)$/m)[1].trim();
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

const ACC = 'act_210867683874813';
const RT = '69dea489a7fd835b5a30efe8';
const DATE_FROM = process.argv[2] || '2026-04-23';
const DATE_TO   = process.argv[3] || DATE_FROM;
const USD = parseFloat(process.argv[4] || '4.9796');

console.log(`Range: ${DATE_FROM} → ${DATE_TO}\n`);

// Meta — mesma query da rota
const metaRes = await pool.query(
  `SELECT campaign_id, campaign_name,
          SUM(spend)::float       AS spend,
          SUM(impressions)::int   AS impressions,
          SUM(clicks)::int        AS clicks,
          SUM(conversions)::int   AS conversions
   FROM meta_ads_metrics
   WHERE account_id = $1 AND date >= $2 AND date <= $3
   GROUP BY campaign_id, campaign_name`,
  [ACC, DATE_FROM, DATE_TO]
);
const metaResults = metaRes.rows.map(r => ({...r, spend: parseFloat(r.spend)}));
console.log(`Meta rows (campaign_id × campaign_name): ${metaResults.length}`);
const totalMetaSpend = metaResults.reduce((s,r) => s + r.spend, 0);
console.log(`Total Meta spend (raw): $${totalMetaSpend.toFixed(2)}  → R$${(totalMetaSpend*USD).toFixed(2)}`);

// Replica metaMap (agrega por campaign_name) — IGUAL ao route.ts
const metaMap = new Map();
metaResults.forEach(mc => {
  const name = mc.campaign_name;
  if (metaMap.has(name)) {
    const ex = metaMap.get(name);
    ex.spend += mc.spend;
  } else {
    metaMap.set(name, { ...mc });
  }
});
const metaResultsFinal = Array.from(metaMap.values());
console.log(`Após merge por nome: ${metaResultsFinal.length} grupos`);
const totalMergedSpend = metaResultsFinal.reduce((s,r) => s + r.spend, 0);
console.log(`Spend total após merge: $${totalMergedSpend.toFixed(2)}  → R$${(totalMergedSpend*USD).toFixed(2)}`);

// rt_ads do RT
const rtAdsRows = await pool.query(
  `SELECT data FROM import_cache WHERE cache_key=$1 AND date_from >= $2 AND date_from <= $3 AND date_from = date_to`,
  [`rt_ad:${RT}`, DATE_FROM, DATE_TO]
);
const rtAds = new Set();
for (const row of rtAdsRows.rows) for (const e of (row.data||[])) if (e.rt_ad) rtAds.add(e.rt_ad);
console.log(`\nrt_ads únicos no cache: ${rtAds.size}`);

// Replica o loop do import route — para cada rt_ad, soma spend dos Meta matches
let totalCost = 0;
const metaNameMatchCount = new Map(); // quantos rt_ads cada nome casa
const cleanRtAds = [...rtAds];
for (const rtAd of cleanRtAds) {
  const escaped = rtAd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(`(?:^|[^a-zA-Z0-9_.])` + escaped + `(?:[^a-zA-Z0-9_.]|$)`, 'i');
  const matching = metaResultsFinal.filter(mc => rx.test(mc.campaign_name));
  for (const mc of matching) {
    metaNameMatchCount.set(mc.campaign_name, (metaNameMatchCount.get(mc.campaign_name)||0) + 1);
    totalCost += mc.spend * USD;
  }
}

console.log(`\nGASTO TOTAL (replica do import route): R$${totalCost.toFixed(2)}`);
console.log(`Receita esperada do screenshot: R$56.951,74 | Gasto do screenshot: R$37.307,86`);

// Quantos nomes Meta foram match por mais de um rt_ad → DOUBLE COUNTING
const dupMatches = [...metaNameMatchCount.entries()].filter(([_,n]) => n > 1);
console.log(`\nNomes Meta casados por MÚLTIPLOS rt_ads (double-counting): ${dupMatches.length}`);
let doubleCounted = 0;
for (const [name, n] of dupMatches.slice(0, 10)) {
  const mc = metaResultsFinal.find(m => m.campaign_name === name);
  const extra = (n - 1) * mc.spend * USD;
  doubleCounted += extra;
  console.log(`  matched ${n}× — "${name.slice(0,80)}"  spend=R$${(mc.spend*USD).toFixed(2)}  extra=R$${extra.toFixed(2)}`);
}
console.log(`Total double-counted (top 10 + restante não mostrado): >= R$${doubleCounted.toFixed(2)}`);

await pool.end();
