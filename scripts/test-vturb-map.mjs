// Teste manual do fluxo vturb-por-campanha.
// Carrega .env.local, lista players, filtra ativos em N dias,
// puxa /traffic_origin/stats (query_key=utm_campaign) e imprime os
// grouped_field normalizados. Compara com amostra de nomes Meta do DB
// se DATABASE_URL estiver disponível.
//
// Uso: node scripts/test-vturb-map.mjs [days]
import fs from 'node:fs';
import path from 'node:path';

const days = Math.max(1, Math.min(90, parseInt(process.argv[2] ?? '7', 10)));

// ---- carrega .env.local manualmente
const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let [, k, v] = m;
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

// ---- token: env primeiro, senão DB
async function getToken() {
  if (process.env.VTURB_API_TOKEN) return process.env.VTURB_API_TOKEN;
  if (!process.env.DATABASE_URL) return null;
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const r = await pool.query(`SELECT value FROM app_settings WHERE key='VTURB_API_TOKEN' LIMIT 1`);
  await pool.end();
  return r.rows[0]?.value ?? null;
}

function normalizeCampaignName(raw) {
  if (!raw) return '';
  let s = String(raw).replace(/\+/g, ' ');
  try { s = decodeURIComponent(s); } catch {}
  return s.trim().toLowerCase();
}

const BASE = 'https://analytics.vturb.net';
function hdrs(token) {
  return { 'X-Api-Token': token, 'X-Api-Version': 'v1', 'Content-Type': 'application/json' };
}
async function vpost(endpoint, token, body) {
  const res = await fetch(`${BASE}${endpoint}`, { method: 'POST', headers: hdrs(token), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${endpoint} ${res.status}: ${await res.text()}`);
  return res.json();
}
async function vget(endpoint, token) {
  const res = await fetch(`${BASE}${endpoint}`, { headers: hdrs(token) });
  if (!res.ok) throw new Error(`${endpoint} ${res.status}: ${await res.text()}`);
  return res.json();
}

function fmt(d) { return d.toISOString().slice(0, 10); }

(async () => {
  const token = await getToken();
  if (!token) { console.error('❌ sem VTURB_API_TOKEN'); process.exit(1); }

  const now = new Date();
  const to = new Date(now); to.setDate(now.getDate());
  const from = new Date(now); from.setDate(now.getDate() - (days - 1));
  const dateFrom = fmt(from), dateTo = fmt(to);
  console.log(`\n▶ range: ${dateFrom} → ${dateTo} (${days}d)\n`);

  // 1) players
  const rawPlayers = await vget('/players/list', token);
  const playersArr = Array.isArray(rawPlayers) ? rawPlayers : (rawPlayers.data ?? rawPlayers.players ?? []);
  const players = playersArr
    .map(p => ({
      id: String(p.id ?? p.player_id ?? ''),
      name: p.name ?? p.title ?? null,
      video_duration: Number(p.video_duration ?? p.duration ?? 0),
      pitch_time: Number(p.pitch_time ?? 0),
    }))
    .filter(p => p.id && p.video_duration > 0);
  console.log(`1) players com duration>0: ${players.length}`);

  // 2) players ativos
  // probe em batches (payload com 1734 players não volta nada)
  const BATCH = 100;
  const activeIds = new Set();
  let sampleShown = false;
  for (let i = 0; i < players.length; i += BATCH) {
    const batch = players.slice(i, i + BATCH);
    const activeResp = await vpost('/events/total_by_company_players', token, {
      events: ['viewed'],
      start_date: dateFrom,
      end_date: dateTo,
      players_start_date: batch.map(p => ({ player_id: p.id, start_date: dateFrom })),
    });
    const rows = Array.isArray(activeResp) ? activeResp : (activeResp.data ?? activeResp.players ?? activeResp.stats ?? []);
    if (!sampleShown && rows.length) {
      console.log('   DEBUG sample activeRow:', JSON.stringify(rows[0]));
      sampleShown = true;
    }
    for (const r of rows) {
      if (Number(r.total ?? r.total_viewed ?? r.viewed ?? 0) > 0) {
        activeIds.add(String(r.player_id ?? r.id));
      }
    }
  }
  const active = players.filter(p => activeIds.has(p.id));
  console.log(`2) players ativos (viewed>0): ${active.length}`);
  if (active.length === 0) { console.log('⚠ nenhum player ativo nesse período'); process.exit(0); }

  // 3) traffic_origin/stats por player
  const collected = [];
  for (const p of active) {
    try {
      const body = {
        player_id: p.id,
        start_date: `${dateFrom} 00:00:00`,
        end_date:   `${dateTo} 23:59:59`,
        query_key:  'utm_campaign',
        timezone:   'America/Sao_Paulo',
      };
      if (p.video_duration > 0) body.video_duration = p.video_duration;
      if (p.pitch_time > 0)     body.pitch_time     = p.pitch_time;
      const resp = await vpost('/traffic_origin/stats', token, body);
      const rows = Array.isArray(resp) ? resp : (resp.data ?? resp.stats ?? []);
      for (const r of rows) {
        if (!r.grouped_field) continue;
        collected.push({ player: p.name || p.id, ...r });
      }
    } catch (e) {
      console.warn(`  ⚠ ${p.name || p.id}: ${e.message}`);
    }
  }
  console.log(`3) linhas /traffic_origin/stats: ${collected.length}`);

  // 4) agrega por nome normalizado
  const byName = new Map();
  for (const r of collected) {
    const key = normalizeCampaignName(r.grouped_field);
    if (!key) continue;
    const cur = byName.get(key) ?? { total_viewed:0, total_started:0, total_over_pitch:0, total_clicked:0, samples:new Set() };
    cur.total_viewed     += Number(r.total_viewed     || 0);
    cur.total_started    += Number(r.total_started    || 0);
    cur.total_over_pitch += Number(r.total_over_pitch || 0);
    cur.total_clicked    += Number(r.total_clicked    || 0);
    cur.samples.add(r.grouped_field);
    byName.set(key, cur);
  }

  console.log(`\n4) campanhas agregadas por nome normalizado: ${byName.size}\n`);
  const top = [...byName.entries()].sort((a,b)=>b[1].total_started-a[1].total_started).slice(0, 15);
  console.log('Top 15 por total_started:');
  for (const [key, a] of top) {
    const sample = [...a.samples][0];
    const opr = a.total_started    > 0 ? (a.total_over_pitch / a.total_started)    * 100 : 0;
    const clr = a.total_over_pitch > 0 ? (a.total_clicked    / a.total_over_pitch) * 100 : 0;
    console.log(`  [${sample}]`);
    console.log(`     → "${key}"`);
    console.log(`     viewed=${a.total_viewed} started=${a.total_started} over_pitch=${a.total_over_pitch} clicked=${a.total_clicked}  | over_pitch_rate=${opr.toFixed(1)}%  click_rate=${clr.toFixed(1)}%`);
  }

  // 5) comparar com nomes do Meta (se DB disponível)
  if (!process.env.DATABASE_URL) { console.log('\n(sem DATABASE_URL — pulando comparação com Meta)'); return; }
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    const r = await pool.query(
      `SELECT DISTINCT campaign_name FROM meta_ads_metrics
         WHERE date >= $1 AND date <= $2 AND campaign_name IS NOT NULL
         LIMIT 500`,
      [dateFrom, dateTo]
    );
    const metaNames = r.rows.map(x => x.campaign_name);
    console.log(`\n5) campaign_names distintos no Meta no mesmo período: ${metaNames.length}`);
    let hits = 0, misses = 0;
    const exampleHits = [], exampleMisses = [];
    for (const name of metaNames) {
      const k = normalizeCampaignName(name);
      if (byName.has(k)) { hits++; if (exampleHits.length<5) exampleHits.push(name); }
      else { misses++; if (exampleMisses.length<5) exampleMisses.push(name); }
    }
    console.log(`   ✓ match: ${hits}   ✗ sem vturb: ${misses}`);
    if (exampleHits.length)  console.log(`   exemplos match:`, exampleHits);
    if (exampleMisses.length) console.log(`   exemplos miss:`, exampleMisses);
  } finally {
    await pool.end();
  }
})().catch(e => { console.error('❌', e); process.exit(1); });
