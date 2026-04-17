import fs from 'fs';
const env = fs.readFileSync('.env.local', 'utf8');
const KEY = env.match(/^REDTRACK_API_KEY=(.*)$/m)[1].trim();
const RT_ID = '691250b7c3f17e8305b9b82a';
const DATE = '2026-04-14';

async function probe(group) {
  const url = `https://api.redtrack.io/report?api_key=${KEY}&tz=America/Sao_Paulo&date_from=${DATE}&date_to=${DATE}&group=${group}&campaign_id=${RT_ID}&per=3&page=1`;
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await r.json();
  const arr = Array.isArray(data) ? data : (data?.data || []);
  console.log(`\n=== group=${group} ===  (${arr.length} rows sample)`);
  if (arr.length) console.log(Object.keys(arr[0]).join(', '));
  for (const row of arr.slice(0, 2)) {
    console.log(JSON.stringify(row, null, 2));
  }
}

for (const g of ['rt_campaign', 'rt_ad', 'sub1', 'sub2', 'sub3', 'sub4', 'sub5']) {
  try { await probe(g); } catch (e) { console.log(`${g}: err ${e.message}`); }
  await new Promise(r => setTimeout(r, 1500));
}
