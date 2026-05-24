// Diagnóstico de throttle Meta. Conecta no Postgres, pega META_PROFILES de
// app_settings, e faz uma chamada leve (/me/businesses?limit=5) por perfil
// só para coletar os 3 headers de uso (x-app-usage, x-business-use-case-usage,
// x-ad-account-usage). Imprime os percentuais e classifica qual limite está
// saturado.
//
// Uso: node scripts/diag-meta-throttle.mjs

import { readFileSync } from 'node:fs';
import pg from 'pg';

// Mini-parser de .env (sem dependência). Lê linhas KEY=VALUE, ignora # e linhas
// vazias, e tira aspas em torno do value se houver.
function loadEnvFile(path) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch { return; }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile('.env.local');
loadEnvFile('.env');

const { Pool } = pg;
const API_VERSION = 'v19.0';

function safeParse(v) {
  if (!v) return null;
  try { return JSON.parse(v); } catch { return null; }
}

function maxUsagePct(u) {
  if (!u || typeof u !== 'object') return 0;
  return Math.max(
    Number(u.call_count ?? 0),
    Number(u.total_cputime ?? 0),
    Number(u.total_time ?? 0)
  );
}

function maxNestedPct(nested) {
  if (!nested || typeof nested !== 'object') return 0;
  let max = 0;
  for (const arr of Object.values(nested)) {
    if (!Array.isArray(arr)) continue;
    for (const u of arr) max = Math.max(max, maxUsagePct(u));
  }
  return max;
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL não definido em .env.local');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

  let profiles = [];
  try {
    const r = await pool.query(`SELECT value FROM app_settings WHERE key = 'META_PROFILES' LIMIT 1`);
    if (r.rows[0]?.value) profiles = JSON.parse(r.rows[0].value);
  } catch (e) {
    console.error('Erro lendo META_PROFILES:', e.message);
  }

  if (!profiles.length) {
    console.error('Nenhum perfil em app_settings.META_PROFILES');
    await pool.end();
    process.exit(1);
  }

  console.log(`Encontrados ${profiles.length} perfis Meta. Testando 1 chamada leve por perfil...`);
  console.log('');

  for (const p of profiles) {
    if (!p.token) continue;
    const tag = `[${p.name}]`;
    const url = `https://graph.facebook.com/${API_VERSION}/me/businesses?fields=id,name&limit=5&access_token=${p.token}`;

    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      console.log(`${tag} FETCH ERROR: ${e.message}`);
      continue;
    }

    const app = safeParse(res.headers.get('x-app-usage'));
    const buc = safeParse(res.headers.get('x-business-use-case-usage'));
    const adAcc = safeParse(res.headers.get('x-ad-account-usage'));

    let body;
    try { body = await res.json(); } catch { body = null; }

    const appPct = maxUsagePct(app);
    const bucPct = maxNestedPct(buc);
    const adPct = maxNestedPct(adAcc);

    const status = body?.error
      ? `ERR #${body.error.code}: ${body.error.message}`
      : `OK (${body?.data?.length ?? 0} BMs)`;

    console.log(`${tag} ${status}`);
    console.log(`${tag}   x-app-usage:               ${appPct}%  ${app ? JSON.stringify(app) : '(ausente)'}`);
    console.log(`${tag}   x-business-use-case-usage: ${bucPct}%  ${buc ? JSON.stringify(buc) : '(ausente)'}`);
    console.log(`${tag}   x-ad-account-usage:        ${adPct}%  ${adAcc ? JSON.stringify(adAcc) : '(ausente)'}`);

    let verdict = 'OK — todos os limites baixos.';
    if (appPct >= 80) verdict = `🚨 APP usage ${appPct}% — quota global do app saturada (reseta ~1h)`;
    else if (bucPct >= 80) verdict = `🚨 BUC usage ${bucPct}% — Business Use Case throttling (reseta ~minutos)`;
    else if (adPct >= 80) verdict = `🚨 Ad Account usage ${adPct}% — throttle por ad account (reseta ~minutos)`;
    else if (appPct >= 50 || bucPct >= 50 || adPct >= 50) verdict = 'ATENÇÃO — algum limite > 50%, próximo do throttle';
    console.log(`${tag}   ➜ ${verdict}`);
    console.log('');
  }

  await pool.end();
}

main().catch((e) => {
  console.error('Erro:', e);
  process.exit(1);
});
