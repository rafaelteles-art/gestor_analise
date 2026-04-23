import fs from 'fs';
import pg from 'pg';

const env = fs.readFileSync('.env.local', 'utf8');
const REDTRACK_API_KEY = env.match(/^REDTRACK_API_KEY=(.*)$/m)[1].trim();
const rtId = '691250b7c3f17e8305b9b82a';
const dateFrom = '2026-01-23';
const dateTo = '2026-04-23';

const TMP = 'c:/Apps/REPORT/.tmp';
fs.mkdirSync(TMP, { recursive: true });

// Fetch with retry for rate limits
async function rtFetch(params, label) {
  const url = `https://api.redtrack.io/report?api_key=${REDTRACK_API_KEY}&date_from=${dateFrom}&date_to=${dateTo}&tz=America/Sao_Paulo&${params}&per=5000`;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(url);
    if (res.status === 429) {
      const wait = 2000 * attempt;
      console.log(`[${label}] 429 rate-limit, sleeping ${wait}ms (attempt ${attempt})`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
    const d = await res.json();
    return Array.isArray(d) ? d : (d.data || []);
  }
  throw new Error(`${label}: rate-limit after retries`);
}

async function pause(ms = 1500) { await new Promise(r => setTimeout(r, ms)); }

async function dumpGroup(group, filename) {
  console.log(`Fetching group=${group}...`);
  const rows = await rtFetch(`group=${group}&campaign_id=${rtId}`, group);
  console.log(`  → ${rows.length} rows`);
  fs.writeFileSync(`${TMP}/rt_${filename}.json`, JSON.stringify(rows, null, 2));
  return rows;
}

async function dumpDailyGroup(group, filename) {
  console.log(`Fetching group=date,${group}...`);
  const rows = await rtFetch(`group=date,${group}&campaign_id=${rtId}`, `date-${group}`);
  console.log(`  → ${rows.length} rows`);
  fs.writeFileSync(`${TMP}/rt_${filename}.json`, JSON.stringify(rows, null, 2));
  return rows;
}

// Collect various breakdowns
const results = {};
results.campaign = await dumpGroup('campaign', 'by_campaign');          // Totals for this rt campaign
await pause();
results.sub3 = await dumpGroup('sub3', 'by_fb_campaign');                // FB campaign IDs
await pause();
results.sub2 = await dumpGroup('sub2', 'by_fb_adset');                   // FB adset IDs (will be truncated at 5000)
await pause();
results.sub1 = await dumpGroup('sub1', 'by_fb_ad');                      // FB ad IDs
await pause();
results.sub4 = await dumpGroup('sub4', 'by_rt_ad_name');                 // Ad name (like LT581.3)
await pause();
results.sub5 = await dumpGroup('sub5', 'by_adset_name');                 // Adset name
await pause();
results.sub6 = await dumpGroup('sub6', 'by_campaign_name');              // FB campaign name
await pause();
results.sub7 = await dumpGroup('sub7', 'by_placement');                  // Placement
await pause();
results.sub8 = await dumpGroup('sub8', 'by_site_source');                // FB | IG | an
await pause();
results.date = await dumpGroup('date', 'by_date');                       // Daily totals
await pause();

// Daily × placement to find placement trends
results.date_sub7 = await dumpDailyGroup('sub7', 'by_date_placement');
await pause();

// Daily × FB campaign to see which FB campaigns are performing day by day
results.date_sub3 = await dumpDailyGroup('sub3', 'by_date_fb_campaign');

console.log('\n✅ All data saved to .tmp/ directory');
console.log(`Files: ${fs.readdirSync(TMP).filter(f => f.startsWith('rt_')).join(', ')}`);
