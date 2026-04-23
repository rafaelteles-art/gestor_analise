import fs from 'fs';
const env = fs.readFileSync('.env.local', 'utf8');
const REDTRACK_API_KEY = env.match(/^REDTRACK_API_KEY=(.*)$/m)[1].trim();
const rtId = '691250b7c3f17e8305b9b82a';

const today = new Date();
const from = new Date(today); from.setMonth(from.getMonth() - 3);
const fmt = d => d.toISOString().slice(0, 10);
const dateFrom = fmt(from);
const dateTo = fmt(today);

async function fetchGroup(g) {
  const url = `https://api.redtrack.io/report?api_key=${REDTRACK_API_KEY}&date_from=${dateFrom}&date_to=${dateTo}&tz=America/Sao_Paulo&group=${g}&campaign_id=${rtId}&per=1000`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${g}: HTTP ${res.status}`);
  const d = await res.json();
  return Array.isArray(d) ? d : (d.data || []);
}

// Get only a lean subset — the grouping field + clicks/approved/cost
async function dump(g, n = 10) {
  console.log(`\n=== Group: ${g} ===`);
  const rows = await fetchGroup(g);
  console.log(`Total rows: ${rows.length}`);
  // Sort by clicks desc
  rows.sort((a, b) => (b.clicks || 0) - (a.clicks || 0));
  for (const r of rows.slice(0, n)) {
    // Extract "group" key — likely same-name as group
    const keyField = [g, g.replace('_',''), 'value'].find(k => k in r);
    const k = keyField ? r[keyField] : JSON.stringify(Object.keys(r).filter(x => !['clicks','approved','cost','profit','revenue','total_revenue','total_conversions','convtype1','convtype2','convtype3','convtype4','convtype5'].includes(x) && typeof r[x] === 'string').slice(0,5));
    console.log(`  ${JSON.stringify(k).slice(0,80)}  clicks=${r.clicks}  approved=${r.approved}  cost=${r.cost}  rev=${r.total_revenue}  roas=${r.roas}`);
  }
}

await dump('sub1');
await dump('sub2');
await dump('sub3');
await dump('sub4');
await dump('sub5');
await dump('sub6');
await dump('sub7');
await dump('sub8');
