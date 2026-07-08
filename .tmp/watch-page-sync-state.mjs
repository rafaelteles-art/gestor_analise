// Monitor read-only: observa o state dos jobs running/pending: accountOffset avança ou reseta?
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
});

const res = await pool.query(`
  SELECT id, status, profiles, total, cursor, state, message, leased_until,
         now() AS db_now, started_at
    FROM page_sync_jobs
   WHERE status IN ('running', 'pending')
   ORDER BY created_at ASC`);

console.log(`db_now = ${res.rows[0]?.db_now ?? '(sem jobs ativos)'}`);
for (const r of res.rows) {
  const st = r.state ?? {};
  console.log(
    `#${r.id} ${r.status} profiles=${r.profiles ? r.profiles.join(',') : 'ALL'} total=${r.total}` +
    ` | state: profileIndex=${st.profileIndex ?? '-'} phase=${st.phase ?? '-'}` +
    ` accounts=${Array.isArray(st.accounts) ? st.accounts.length : st.accounts}` +
    ` accountOffset=${st.accountOffset ?? '-'} failed=${JSON.stringify(st.failed ?? [])}` +
    `\n    leased_until=${r.leased_until} | msg="${(r.message ?? '').slice(0, 100)}"`
  );
}

const prof = await pool.query(`SELECT value FROM app_settings WHERE key = 'META_PROFILES'`);
try {
  const list = JSON.parse(prof.rows[0]?.value ?? '[]');
  console.log(`\nMETA_PROFILES: ${list.length} perfis → ${list.map((p) => p.name).join(', ')}`);
} catch (e) {
  console.log('META_PROFILES parse falhou:', e.message);
}

await pool.end();
