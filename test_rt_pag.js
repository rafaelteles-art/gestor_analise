const fs = require('fs');
require('dotenv').config({path: '.env.local'});
const apiKey = process.env.REDTRACK_API_KEY;

async function run() {
  const q1 = `https://api.redtrack.io/report?api_key=${apiKey}&date_from=2026-03-01&date_to=2026-04-10&tz=America/Sao_Paulo&group=rt_campaign&per=1000&page=1`;
  const q2 = `https://api.redtrack.io/report?api_key=${apiKey}&date_from=2026-03-01&date_to=2026-04-10&tz=America/Sao_Paulo&group=rt_campaign&per=1000&page=2`;
  
  const r1 = await fetch(q1).then(r=>r.json());
  const r2 = await fetch(q2).then(r=>r.json());
  
  console.log('Page 1:', r1.length);
  console.log('Page 2:', Array.isArray(r2) ? r2.length : typeof r2);
}
run();
