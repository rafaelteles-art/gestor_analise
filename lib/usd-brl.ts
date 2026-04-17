import { pool } from '@/lib/db';

// Cache USD→BRL no banco. Uma única requisição ao AwesomeAPI
// traz 30 dias; só busca de novo quando o dia atual ainda não está gravado.
// Fallback: PTAX/BCB (um dia por vez). Último recurso: 5.50.

const FALLBACK_RATE = 5.50;

let schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usd_brl_rates (
      date       DATE PRIMARY KEY,
      rate       NUMERIC(10, 6) NOT NULL,
      source     TEXT NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  schemaReady = true;
}

type DailyEntry = { timestamp?: string; bid?: string; ask?: string };

async function fetchAwesomeApiDaily(days: number): Promise<{ date: string; rate: number }[]> {
  const res = await fetch(
    `https://economia.awesomeapi.com.br/json/daily/USD-BRL/${days}`,
    { cache: 'no-store', signal: AbortSignal.timeout(8000) }
  );
  if (!res.ok) throw new Error(`AwesomeAPI HTTP ${res.status}`);
  const data = (await res.json()) as DailyEntry[];
  if (!Array.isArray(data) || data.length === 0) throw new Error('AwesomeAPI vazio');

  const out: { date: string; rate: number }[] = [];
  for (const entry of data) {
    if (!entry.timestamp || !entry.bid) continue;
    const d = new Date(Number(entry.timestamp) * 1000);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    out.push({ date: `${yyyy}-${mm}-${dd}`, rate: parseFloat(entry.bid) });
  }
  return out;
}

async function fetchBcbPtax(dateStr: string): Promise<number | null> {
  const [y, m, d] = dateStr.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  for (let i = 0; i < 5; i++) {
    const dt = new Date(base);
    dt.setUTCDate(dt.getUTCDate() - i);
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    const yyyy = dt.getUTCFullYear();
    try {
      const res = await fetch(
        `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarDia(dataCotacao=@dataCotacao)?@dataCotacao='${mm}-${dd}-${yyyy}'&$top=1&$format=json&$select=cotacaoVenda`,
        { cache: 'no-store', signal: AbortSignal.timeout(5000) }
      );
      if (!res.ok) continue;
      const json = await res.json();
      if (Array.isArray(json?.value) && json.value.length > 0) {
        return parseFloat(json.value[0].cotacaoVenda);
      }
    } catch { /* próxima tentativa */ }
  }
  return null;
}

async function upsertRates(rows: { date: string; rate: number }[], source: string) {
  if (rows.length === 0) return;
  const values: string[] = [];
  const params: any[] = [];
  rows.forEach((r, i) => {
    const o = i * 3;
    values.push(`($${o + 1}, $${o + 2}, $${o + 3})`);
    params.push(r.date, r.rate, source);
  });
  await pool.query(
    `INSERT INTO usd_brl_rates (date, rate, source)
     VALUES ${values.join(', ')}
     ON CONFLICT (date) DO UPDATE
       SET rate = EXCLUDED.rate,
           source = EXCLUDED.source,
           fetched_at = NOW()`,
    params
  );
}

/**
 * Retorna a cotação USD→BRL para a data pedida (YYYY-MM-DD).
 * - Se já estiver no banco, retorna direto.
 * - Senão, busca os últimos 30 dias da AwesomeAPI numa única requisição e grava tudo.
 * - Se AwesomeAPI falhar, tenta PTAX/BCB para a data específica.
 * - Se tudo falhar, retorna 5.50 (sem gravar).
 * Quando a data pedida ainda não tem valor (ex.: fim de semana), usa o dia útil anterior.
 */
export async function getUsdToBrl(dateStr: string): Promise<number> {
  await ensureSchema();

  // 1. Já temos no banco? (exato ou dia útil anterior mais próximo)
  const cached = await pool.query(
    `SELECT date, rate FROM usd_brl_rates
     WHERE date <= $1
     ORDER BY date DESC
     LIMIT 1`,
    [dateStr]
  );
  // Só confiamos no cache se cobre a data pedida exatamente, OU se a data
  // pedida é futura/igual a hoje e já temos um valor recente (<= 1 dia).
  const today = new Date().toISOString().slice(0, 10);
  if (cached.rows.length > 0) {
    const row = cached.rows[0];
    const cachedDate = row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date).slice(0, 10);
    if (cachedDate === dateStr) return parseFloat(row.rate);
    // Se pediram data passada e não temos exato, faltou dado — vamos buscar.
    // Se pediram hoje e já temos um valor do dia útil anterior dentro da última semana, use-o.
    if (dateStr >= today) {
      const diffDays = (new Date(dateStr).getTime() - new Date(cachedDate).getTime()) / 86400000;
      if (diffDays <= 7) return parseFloat(row.rate);
    }
  }

  // 2. AwesomeAPI (30 dias numa requisição)
  try {
    const rows = await fetchAwesomeApiDaily(30);
    await upsertRates(rows, 'awesomeapi');
    console.log(`[usd-brl] AwesomeAPI: ${rows.length} dias gravados`);
    const match = rows.find(r => r.date === dateStr);
    if (match) return match.rate;
    // Data pedida não veio (feriado/fds) — pega o dia útil anterior mais próximo.
    const fallback = rows
      .filter(r => r.date <= dateStr)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (fallback) return fallback.rate;
  } catch (e) {
    console.warn('[usd-brl] AwesomeAPI falhou:', (e as Error).message);
  }

  // 3. Fallback: PTAX/BCB (um dia por vez, recua até 5 dias)
  const ptax = await fetchBcbPtax(dateStr);
  if (ptax !== null) {
    await upsertRates([{ date: dateStr, rate: ptax }], 'bcb-ptax');
    return ptax;
  }

  // 4. Último recurso: valor mais recente em cache, mesmo antigo
  if (cached.rows.length > 0) {
    console.warn(`[usd-brl] Usando cotação antiga em cache para ${dateStr}`);
    return parseFloat(cached.rows[0].rate);
  }

  console.warn(`[usd-brl] Todas as fontes falharam para ${dateStr}, usando fallback ${FALLBACK_RATE}`);
  return FALLBACK_RATE;
}
