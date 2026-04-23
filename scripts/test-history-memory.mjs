// Simula /api/history sob as restrições do Cloud Run (Firebase App Hosting).
//
// Uso:
//   node --max-old-space-size=400 scripts/test-history-memory.mjs [--old]
//
// --max-old-space-size=400 simula ~512MiB de container (deixando ~110MB pra
// stack, libs nativas, buffers). Se o script não estourar, a config real de
// 2GiB tem 4x de margem.
//
// Flag --old roda a versão antiga (JSONB arrays completos), pra comparar.

import pg from 'pg';
import fs from 'fs';
import { format, subDays } from 'date-fns';

const { Pool } = pg;
const USE_OLD = process.argv.includes('--old');

const DATABASE_URL = fs.readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=(.*)$/m)[1].trim();
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function rss() {
  return (process.memoryUsage.rss() / 1024 / 1024).toFixed(1) + ' MB';
}
function heap() {
  const u = process.memoryUsage();
  return (u.heapUsed / 1024 / 1024).toFixed(1) + ' MB';
}

function buildRtAdRegex(rtAd) {
  const escapedAd = rtAd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-zA-Z0-9_.])` + escapedAd + `(?:[^a-zA-Z0-9_.]|$)`, 'i');
}

// ============================================================
// Descobre um payload realista: pega o rt_campaign_id mais "pesado"
// (mais entries no rt_camp cache nos ultimos 30 dias), junto com a conta Meta
// que tem mais dados naquele periodo.
// ============================================================
async function pickTestPayload() {
  const d29ago = format(subDays(new Date(), 29), 'yyyy-MM-dd');
  const today  = format(new Date(), 'yyyy-MM-dd');

  console.log(`[setup] descobrindo payload de teste (${d29ago} → ${today})...`);

  const { rows: campRows } = await pool.query(
    `SELECT
       SPLIT_PART(cache_key, ':', 2) AS rt_campaign_id,
       SUM(jsonb_array_length(data)) AS entries
     FROM import_cache
     WHERE cache_key LIKE 'rt_camp:%'
       AND date_from >= $1
       AND date_from = date_to
     GROUP BY rt_campaign_id
     ORDER BY entries DESC
     LIMIT 5`,
    [d29ago]
  );

  if (campRows.length === 0) throw new Error('Nenhuma rt_campaign encontrada');
  console.log(`[setup] top 5 rt_campaign_ids por volume:`);
  for (const r of campRows) console.log(`  ${r.rt_campaign_id}: ${r.entries} entries`);

  const rtCampaignId = campRows[0].rt_campaign_id;

  const { rows: accRows } = await pool.query(
    `SELECT account_id, COUNT(*) AS rows_count, SUM(spend) AS spend
     FROM meta_ads_metrics
     WHERE date >= $1
     GROUP BY account_id
     ORDER BY rows_count DESC
     LIMIT 5`,
    [d29ago]
  );
  console.log(`[setup] top 5 metaAccountIds por volume:`);
  for (const r of accRows) console.log(`  ${r.account_id}: ${r.rows_count} rows, spend=${r.spend}`);

  const metaAccountId = accRows[0].account_id;

  const { rows: adRows } = await pool.query(
    `SELECT DISTINCT entry->>'rt_ad' AS rt_ad
     FROM import_cache ic, jsonb_array_elements(ic.data) entry
     WHERE ic.cache_key = $1
       AND ic.date_from >= $2
       AND ic.date_from = ic.date_to
       AND entry->>'rt_ad' IS NOT NULL
       AND entry->>'rt_ad' <> ''`,
    [`rt_ad:${rtCampaignId}`, d29ago]
  );
  const rtAds = adRows.map(r => r.rt_ad);

  return { metaAccountId, rtCampaignId, rtAds, today, d29ago };
}

// ============================================================
// Versão NOVA — unnest em SQL (a que queremos validar).
// ============================================================
async function runNew({ metaAccountId, rtCampaignId, rtAds, today, d29ago }) {
  const RANGES = [
    { label: 'Hoje',     dateFrom: today },
    { label: '2D',       dateFrom: format(subDays(new Date(), 1),  'yyyy-MM-dd') },
    { label: '3D',       dateFrom: format(subDays(new Date(), 2),  'yyyy-MM-dd') },
    { label: '7D',       dateFrom: format(subDays(new Date(), 6),  'yyyy-MM-dd') },
    { label: '14D',      dateFrom: format(subDays(new Date(), 13), 'yyyy-MM-dd') },
    { label: '30D+HOJE', dateFrom: d29ago },
  ];

  const [rtCampFlat, rtCampIdFlat, metaRes] = await Promise.all([
    pool.query(
      `SELECT
         to_char(ic.date_from, 'YYYY-MM-DD') AS date,
         entry->>'rt_campaign'                                   AS key,
         COALESCE(NULLIF(entry->>'total_revenue', '')::float, 0) AS total_revenue,
         COALESCE(NULLIF(entry->>'convtype2',     '')::int,   0) AS convtype2
       FROM import_cache ic, jsonb_array_elements(ic.data) entry
       WHERE ic.cache_key = $1 AND ic.date_from >= $2 AND ic.date_from = ic.date_to
         AND entry->>'rt_campaign' IS NOT NULL AND entry->>'rt_campaign' <> ''`,
      [`rt_camp:${rtCampaignId}`, d29ago]
    ),
    pool.query(
      `SELECT
         to_char(ic.date_from, 'YYYY-MM-DD') AS date,
         entry->>'sub3'                                          AS key,
         COALESCE(NULLIF(entry->>'total_revenue', '')::float, 0) AS total_revenue,
         COALESCE(NULLIF(entry->>'convtype2',     '')::int,   0) AS convtype2
       FROM import_cache ic, jsonb_array_elements(ic.data) entry
       WHERE ic.cache_key = $1 AND ic.date_from >= $2 AND ic.date_from = ic.date_to
         AND entry->>'sub3' IS NOT NULL AND entry->>'sub3' <> ''`,
      [`rt_camp_id:${rtCampaignId}`, d29ago]
    ),
    pool.query(
      `SELECT campaign_id, campaign_name, to_char(date,'YYYY-MM-DD') AS date,
              SUM(spend)::float AS spend, SUM(conversions)::int AS conversions
       FROM meta_ads_metrics
       WHERE account_id = $1 AND date >= $2 AND date <= $3
       GROUP BY campaign_id, campaign_name, date`,
      [metaAccountId, d29ago, today]
    ),
  ]);

  console.log(`[new] rows: rt_camp=${rtCampFlat.rows.length}, rt_camp_id=${rtCampIdFlat.rows.length}, meta=${metaRes.rows.length}`);
  console.log(`[new] after queries: rss=${rss()} heap=${heap()}`);

  const rtAdRegexes = rtAds.map(ad => ({ rtAd: ad, regex: buildRtAdRegex(ad) }));
  const perRtAd = {};
  for (const ad of rtAds) perRtAd[ad] = {};

  for (const { label, dateFrom } of RANGES) {
    const rtCampByName = new Map();
    for (const r of rtCampFlat.rows) {
      if (r.date < dateFrom) continue;
      const cur = rtCampByName.get(r.key);
      if (cur) { cur.total_revenue += r.total_revenue; cur.convtype2 += r.convtype2; }
      else rtCampByName.set(r.key, { total_revenue: r.total_revenue, convtype2: r.convtype2 });
    }
    const rtByMetaId = new Map();
    for (const r of rtCampIdFlat.rows) {
      if (r.date < dateFrom) continue;
      const cur = rtByMetaId.get(r.key);
      if (cur) { cur.total_revenue += r.total_revenue; cur.convtype2 += r.convtype2; }
      else rtByMetaId.set(r.key, { total_revenue: r.total_revenue, convtype2: r.convtype2 });
    }

    const metaMap = new Map();
    for (const row of metaRes.rows) {
      if (row.date < dateFrom) continue;
      const existing = metaMap.get(row.campaign_name);
      if (existing) {
        existing.spend += row.spend;
        if (!existing.campaign_ids.includes(row.campaign_id)) existing.campaign_ids.push(row.campaign_id);
      } else {
        metaMap.set(row.campaign_name, { campaign_ids: [row.campaign_id], campaign_name: row.campaign_name, spend: row.spend });
      }
    }

    const metaEnriched = [];
    for (const mc of metaMap.values()) {
      let totalRev = 0, totalConv = 0, anyHit = false;
      for (const id of mc.campaign_ids) {
        const byId = rtByMetaId.get(id);
        if (byId) { anyHit = true; totalRev += byId.total_revenue; totalConv += byId.convtype2; }
      }
      let rev = 0, conv = 0;
      if (anyHit) { rev = totalRev; conv = totalConv; }
      else {
        const metaLower = mc.campaign_name.toLowerCase();
        for (const [rtName, rtCamp] of rtCampByName) {
          const isExact = rtName === mc.campaign_name;
          const isPartial = rtName.length > 10 && metaLower.includes(rtName.toLowerCase());
          if (isExact || isPartial) { rev += rtCamp.total_revenue; conv += rtCamp.convtype2; }
        }
      }
      metaEnriched.push({ campaign_name: mc.campaign_name, spendBrl: mc.spend, rev, conv });
    }

    for (const { rtAd, regex } of rtAdRegexes) {
      let totalSpend = 0, totalRevenue = 0, totalConversions = 0;
      for (const mc of metaEnriched) {
        if (!regex.test(mc.campaign_name)) continue;
        totalSpend += mc.spendBrl; totalRevenue += mc.rev; totalConversions += mc.conv;
      }
      perRtAd[rtAd][label] = { cost: totalSpend, revenue: totalRevenue, sales: totalConversions };
    }
  }

  return perRtAd;
}

// ============================================================
// Versão ANTIGA — JSONB arrays completos (reproduz o OOM).
// ============================================================
async function runOld({ metaAccountId, rtCampaignId, rtAds, today, d29ago }) {
  const RANGES = [
    { label: 'Hoje', dateFrom: today },
    { label: '2D',   dateFrom: format(subDays(new Date(), 1),  'yyyy-MM-dd') },
    { label: '3D',   dateFrom: format(subDays(new Date(), 2),  'yyyy-MM-dd') },
    { label: '7D',   dateFrom: format(subDays(new Date(), 6),  'yyyy-MM-dd') },
    { label: '14D',  dateFrom: format(subDays(new Date(), 13), 'yyyy-MM-dd') },
    { label: '30D+HOJE', dateFrom: d29ago },
  ];

  const [rtCampResult, rtCampIdResult, metaRes] = await Promise.all([
    pool.query(
      `SELECT to_char(date_from, 'YYYY-MM-DD') AS date_from, data FROM import_cache
       WHERE cache_key = $1 AND date_from >= $2 AND date_from = date_to ORDER BY date_from`,
      [`rt_camp:${rtCampaignId}`, d29ago]
    ),
    pool.query(
      `SELECT to_char(date_from, 'YYYY-MM-DD') AS date_from, data FROM import_cache
       WHERE cache_key = $1 AND date_from >= $2 AND date_from = date_to ORDER BY date_from`,
      [`rt_camp_id:${rtCampaignId}`, d29ago]
    ),
    pool.query(
      `SELECT campaign_id, campaign_name, to_char(date,'YYYY-MM-DD') AS date,
              SUM(spend)::float AS spend, SUM(conversions)::int AS conversions
       FROM meta_ads_metrics WHERE account_id = $1 AND date >= $2 AND date <= $3
       GROUP BY campaign_id, campaign_name, date`,
      [metaAccountId, d29ago, today]
    ),
  ]);

  const totalEntries =
    rtCampResult.rows.reduce((s, r) => s + (r.data?.length || 0), 0) +
    rtCampIdResult.rows.reduce((s, r) => s + (r.data?.length || 0), 0);
  console.log(`[old] rows: rt_camp=${rtCampResult.rows.length}, rt_camp_id=${rtCampIdResult.rows.length}, meta=${metaRes.rows.length}`);
  console.log(`[old] JSONB entries totais parseadas: ${totalEntries}`);
  console.log(`[old] after queries: rss=${rss()} heap=${heap()}`);

  // Processa igual a rota antiga faria (so pra puxar a memoria)
  const rtAdRegexes = rtAds.map(ad => ({ rtAd: ad, regex: buildRtAdRegex(ad) }));
  const perRtAd = {};
  for (const ad of rtAds) perRtAd[ad] = {};

  for (const { label, dateFrom } of RANGES) {
    const rtCampByName = new Map();
    for (const row of rtCampResult.rows) {
      if (row.date_from < dateFrom) continue;
      for (const e of (row.data || [])) {
        if (!e.rt_campaign) continue;
        const cur = rtCampByName.get(e.rt_campaign) ?? { total_revenue: 0, convtype2: 0 };
        cur.total_revenue += parseFloat(e.total_revenue || '0');
        cur.convtype2     += parseInt(e.convtype2 || '0', 10);
        rtCampByName.set(e.rt_campaign, cur);
      }
    }
    const rtByMetaId = new Map();
    for (const row of rtCampIdResult.rows) {
      if (row.date_from < dateFrom) continue;
      for (const e of (row.data || [])) {
        if (!e.sub3) continue;
        const cur = rtByMetaId.get(e.sub3) ?? { total_revenue: 0, convtype2: 0 };
        cur.total_revenue += parseFloat(e.total_revenue || '0');
        cur.convtype2     += parseInt(e.convtype2 || '0', 10);
        rtByMetaId.set(e.sub3, cur);
      }
    }
    // (loops restantes identicos — ommitidos pra brevidade do teste de memoria)
  }
  return perRtAd;
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  const heapCap = process.execArgv.find(a => a.startsWith('--max-old-space-size'));
  console.log(`[env] Node heap cap: ${heapCap || '(default)'}`);
  console.log(`[env] versao: ${USE_OLD ? 'ANTIGA (JSONB completo)' : 'NOVA (unnest em SQL)'}`);
  console.log(`[env] start: rss=${rss()} heap=${heap()}`);

  const payload = await pickTestPayload();
  console.log(`[setup] payload: metaAccountId=${payload.metaAccountId}, rtCampaignId=${payload.rtCampaignId}, rtAds=${payload.rtAds.length}`);

  // Roda 3x seguidas pra simular carga repetida
  const runs = 3;
  let peakRss = 0;
  const t0 = Date.now();

  const peakTimer = setInterval(() => {
    const cur = process.memoryUsage.rss();
    if (cur > peakRss) peakRss = cur;
  }, 50);

  for (let i = 1; i <= runs; i++) {
    const t = Date.now();
    const out = USE_OLD ? await runOld(payload) : await runNew(payload);
    const ms = Date.now() - t;
    const keys = Object.keys(out);
    console.log(`[run ${i}/${runs}] ${ms}ms | rss=${rss()} heap=${heap()} | rt_ads_out=${keys.length} | sample.Hoje=`,
      keys[0] ? out[keys[0]].Hoje : null);
    if (global.gc) global.gc();
  }

  clearInterval(peakTimer);
  const totalMs = Date.now() - t0;
  console.log(`\n[RESULT]`);
  console.log(`  total: ${totalMs}ms (${runs} runs)`);
  console.log(`  RSS pico: ${(peakRss/1024/1024).toFixed(1)} MB`);
  console.log(`  limite container 512MiB: ${peakRss > 512*1024*1024 ? 'ESTOUROU ❌' : 'OK ✓'}`);
  console.log(`  limite container 2048MiB: ${peakRss > 2048*1024*1024 ? 'ESTOUROU ❌' : 'OK ✓'}`);

  await pool.end();
}

main().catch(async (e) => {
  console.error('[FATAL]', e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
