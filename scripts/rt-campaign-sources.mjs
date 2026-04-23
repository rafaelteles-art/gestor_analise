import fs from 'fs';
const env = fs.readFileSync('.env.local', 'utf8');
const REDTRACK_API_KEY = env.match(/^REDTRACK_API_KEY=(.*)$/m)[1].trim();
const rtId = '691250b7c3f17e8305b9b82a';

// 3 months back
const today = new Date();
const from = new Date(today);
from.setMonth(from.getMonth() - 3);
const fmt = d => d.toISOString().slice(0, 10);
const dateFrom = fmt(from);
const dateTo = fmt(today);

console.log(`[RT] ${rtId} from ${dateFrom} to ${dateTo}`);

// Group by sub6 (often campaign) -- try several grouping options
const groups = ['sub1','sub2','sub3','sub4','sub5','sub6','sub7','sub8','rt_campaign','rt_adset','rt_ad','rt_source'];
for (const g of groups) {
  const url = `https://api.redtrack.io/report?api_key=${REDTRACK_API_KEY}&date_from=${dateFrom}&date_to=${dateTo}&tz=America/Sao_Paulo&group=${g}&campaign_id=${rtId}&per=5`;
  try {
    const res = await fetch(url);
    if (!res.ok) { console.log(`  ${g}: HTTP ${res.status}`); continue; }
    const d = await res.json();
    const arr = Array.isArray(d) ? d : (d.data || []);
    const first = arr[0] || {};
    console.log(`\n[${g}] ${arr.length} rows; sample keys: ${Object.keys(first).slice(0,30).join(', ')}`);
    if (arr.length) console.log(`  first row:`, JSON.stringify(first).slice(0, 400));
  } catch(e){ console.log(`  ${g}: ${e.message}`); }
}
