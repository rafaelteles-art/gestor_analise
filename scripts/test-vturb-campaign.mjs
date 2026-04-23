// Pega uma campanha Meta com match no vturb e imprime retenção/conversão.
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let [, k, v] = m;
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

const days = Math.max(1, Math.min(90, parseInt(process.argv[2] ?? '7', 10)));
const BASE = 'https://analytics.vturb.net';

function normalizeCampaignName(raw) {
  if (!raw) return '';
  let s = String(raw).replace(/\+/g, ' ');
  try { s = decodeURIComponent(s); } catch {}
  return s.trim().toLowerCase();
}

const hdrs = (t) => ({ 'X-Api-Token': t, 'X-Api-Version': 'v1', 'Content-Type': 'application/json' });
async function vpost(ep, t, b) { const r = await fetch(`${BASE}${ep}`, { method: 'POST', headers: hdrs(t), body: JSON.stringify(b) }); if (!r.ok) throw new Error(`${ep} ${r.status}`); return r.json(); }
async function vget(ep, t)  { const r = await fetch(`${BASE}${ep}`, { headers: hdrs(t) }); if (!r.ok) throw new Error(`${ep} ${r.status}`); return r.json(); }
const fmt = (d) => d.toISOString().slice(0, 10);

async function getToken() {
  if (process.env.VTURB_API_TOKEN) return process.env.VTURB_API_TOKEN;
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const r = await pool.query(`SELECT value FROM app_settings WHERE key='VTURB_API_TOKEN' LIMIT 1`);
  await pool.end();
  return r.rows[0]?.value;
}

(async () => {
  const token = await getToken();
  const now = new Date();
  const to = new Date(now);
  const from = new Date(now); from.setDate(now.getDate() - (days - 1));
  const dateFrom = fmt(from), dateTo = fmt(to);

  // 1) players ativos
  const list = await vget('/players/list', token);
  const players = (Array.isArray(list) ? list : list.data ?? list.players ?? [])
    .map(p => ({ id: String(p.id ?? p.player_id), name: p.name ?? p.title ?? null, video_duration: Number(p.video_duration ?? p.duration ?? 0), pitch_time: Number(p.pitch_time ?? 0) }))
    .filter(p => p.id && p.video_duration > 0);

  const activeIds = new Set();
  for (let i = 0; i < players.length; i += 100) {
    const batch = players.slice(i, i + 100);
    const resp = await vpost('/events/total_by_company_players', token, {
      events: ['viewed'], start_date: dateFrom, end_date: dateTo,
      players_start_date: batch.map(p => ({ player_id: p.id, start_date: dateFrom })),
    });
    const rows = Array.isArray(resp) ? resp : (resp.data ?? resp.players ?? []);
    for (const r of rows) if (Number(r.total ?? 0) > 0) activeIds.add(String(r.player_id));
  }
  const active = players.filter(p => activeIds.has(p.id));

  // 2) traffic_origin por player
  const collected = [];
  for (const p of active) {
    try {
      const body = {
        player_id: p.id,
        start_date: `${dateFrom} 00:00:00`, end_date: `${dateTo} 23:59:59`,
        query_key: 'utm_campaign', timezone: 'America/Sao_Paulo',
      };
      if (p.video_duration > 0) body.video_duration = p.video_duration;
      if (p.pitch_time > 0) body.pitch_time = p.pitch_time;
      const resp = await vpost('/traffic_origin/stats', token, body);
      const rows = Array.isArray(resp) ? resp : (resp.data ?? resp.stats ?? []);
      for (const r of rows) if (r.grouped_field) collected.push(r);
    } catch {}
  }

  // 3) agrega por nome normalizado
  const byName = new Map();
  for (const r of collected) {
    const k = normalizeCampaignName(r.grouped_field);
    if (!k) continue;
    const cur = byName.get(k) ?? { samples: new Set(), viewed:0, viewed_uniq:0, started:0, over_pitch:0, clicked:0, conversions:0 };
    cur.samples.add(r.grouped_field);
    cur.viewed      += Number(r.total_viewed              || 0);
    cur.viewed_uniq += Number(r.total_viewed_device_uniq  || 0);
    cur.started     += Number(r.total_started             || 0);
    cur.over_pitch  += Number(r.total_over_pitch          || 0);
    cur.clicked     += Number(r.total_clicked             || 0);
    cur.conversions += Number(r.total_conversions         || 0);
    byName.set(k, cur);
  }

  // 4) pega um Meta com match e que tenha dados expressivos
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const res = await pool.query(
    `SELECT campaign_id, campaign_name, SUM(spend) AS spend, SUM(impressions) AS imp, SUM(clicks) AS clk
       FROM meta_ads_metrics
       WHERE date >= $1 AND date <= $2 AND campaign_name IS NOT NULL
       GROUP BY campaign_id, campaign_name
       ORDER BY SUM(spend) DESC NULLS LAST
       LIMIT 200`,
    [dateFrom, dateTo],
  );
  await pool.end();

  const candidates = res.rows
    .map(r => ({ ...r, key: normalizeCampaignName(r.campaign_name), agg: byName.get(normalizeCampaignName(r.campaign_name)) }))
    .filter(r => r.agg && r.agg.started > 100);

  if (candidates.length === 0) { console.log('sem candidato com match + tráfego relevante'); return; }
  const pick = candidates[0];
  const a = pick.agg;

  const playRate  = a.viewed      > 0 ? (a.started     / a.viewed)      * 100 : 0;
  const retention = a.started     > 0 ? (a.over_pitch  / a.started)     * 100 : 0;
  const convRate  = a.viewed_uniq > 0 ? (a.conversions / a.viewed_uniq) * 100 : 0;

  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`  CAMPANHA META                             ${dateFrom} → ${dateTo}`);
  console.log(`═══════════════════════════════════════════════════════════`);
  console.log(`  Nome:        ${pick.campaign_name}`);
  console.log(`  campaign_id: ${pick.campaign_id}`);
  console.log(`  Spend:       $${Number(pick.spend).toFixed(2)}  |  Impressões: ${pick.imp}  |  Clicks: ${pick.clk}`);
  console.log(`\n  Chave normalizada:  "${pick.key}"`);
  console.log(`  utm_campaign vturb: ${[...a.samples].slice(0,2).join('  ||  ')}`);
  console.log(`\n  ───── VTURB (agregado) ─────`);
  console.log(`  viewed       = ${a.viewed}   (carregou o player)`);
  console.log(`  viewed_uniq  = ${a.viewed_uniq}   (visualizações únicas por device)`);
  console.log(`  started      = ${a.started}   (apertou play)`);
  console.log(`  over_pitch   = ${a.over_pitch}   (passou do pitch)`);
  console.log(`  clicked      = ${a.clicked}   (clicou na oferta)`);
  console.log(`  conversions  = ${a.conversions}   (compras reais)`);
  console.log(`\n  ───── TAXAS ─────`);
  console.log(`  play_rate        = ${playRate.toFixed(2)}%   (started/viewed)`);
  console.log(`  retenção (pitch) = ${retention.toFixed(2)}%   (over_pitch/started)`);
  console.log(`  conversão        = ${convRate.toFixed(2)}%   (conversions/viewed_uniq)`);
  console.log(`═══════════════════════════════════════════════════════════\n`);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
