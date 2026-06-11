import { pool } from './db';

// ─── Advisory lock (serializa o Account Sync) ─────────────────────────────────
//
// Chave fixa do advisory lock que serializa o Account Sync. TANTO o cron horário
// (/api/cron/accounts-sync) QUANTO o "Sincronizar Meta" manual (/api/accounts/sync)
// passam por aqui, então nunca rodam dois BM-walks concorrentes — o que dobraria a
// carga na Meta e agravaria o throttle #4. Valor arbitrário, único no app.
const ACCOUNT_SYNC_LOCK_KEY = 776655;

export type LockedRun<T> =
  | { ran: true; result: T }
  | { ran: false; reason: 'already running' };

/**
 * Tenta adquirir o advisory lock e roda `fn`. Se outro processo já o segura,
 * retorna `{ ran:false }` sem executar.
 *
 * O lock é session-level (`pg_try_advisory_lock`), então lock + unlock precisam
 * acontecer NA MESMA conexão — por isso seguramos um client dedicado do pool
 * durante toda a execução. O scan abre sua própria conexão para o BEGIN/COMMIT,
 * então este client extra só carrega o lock.
 */
export async function withAccountSyncLock<T>(fn: () => Promise<T>): Promise<LockedRun<T>> {
  const client = await pool.connect();
  let locked = false;
  try {
    const res = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [ACCOUNT_SYNC_LOCK_KEY]);
    locked = res.rows[0]?.ok === true;
    if (!locked) return { ran: false, reason: 'already running' };
    const result = await fn();
    return { ran: true, result };
  } finally {
    if (locked) {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [ACCOUNT_SYNC_LOCK_KEY]);
      } catch (err) {
        console.warn('[account-sync] falha ao liberar advisory lock:', err);
      }
    }
    client.release();
  }
}

// ─── Registro da última execução (monitoramento) ──────────────────────────────
//
// Blob único em app_settings. Honesto sobre o limite: `fetchAllPages` engole erros
// da Meta e devolve dados parciais, então só conseguimos registrar falhas duras
// (lançou) e a contagem resultante — NÃO um parcial silencioso. Conte com quedas
// inexplicadas de `count` como sinal de throttle. Ver docs/adr/0004.
const LAST_RUN_KEY = 'last_account_sync';

export interface AccountSyncStatus {
  ran_at_ms: number;       // epoch millis — instante absoluto, tz-irrelevante
  ok: boolean;             // false = a execução lançou (falha dura)
  count: number | null;    // contas upsertadas (null quando falhou)
  elapsed_ms: number;
  error?: string | null;
  source?: 'cron' | 'manual';
}

export async function recordAccountSyncRun(status: AccountSyncStatus): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [LAST_RUN_KEY, JSON.stringify(status)]
    );
  } catch (err) {
    // Monitoramento é best-effort: nunca derruba o sync por causa do registro.
    console.warn('[account-sync] não foi possível registrar last_account_sync:', err);
  }
}

export async function getAccountSyncStatus(): Promise<AccountSyncStatus | null> {
  try {
    const res = await pool.query(`SELECT value FROM app_settings WHERE key = $1`, [LAST_RUN_KEY]);
    if (!res.rows[0]) return null;
    return JSON.parse(res.rows[0].value) as AccountSyncStatus;
  } catch {
    return null;
  }
}
