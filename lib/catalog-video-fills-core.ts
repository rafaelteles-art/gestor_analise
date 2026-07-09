// Núcleo puro do Scheduled Video Fill (docs/adr/0008 + 0010) — sem dependência
// de banco, no padrão de campaign-jobs-core: este módulo decide QUANDO um fill
// dispara e COMO um arm negocia com o pendente do dia; catalog-video-fills.ts
// (que tem o pool) delega para cá.
import { nextDailyRunAfter, todayStr } from './timezone';

export const FILL_HOUR = 8;
export const FILL_MINUTE = 30;
/** Teto do modo relativo (docs/adr/0010): além de 24h, use o âncora do dia seguinte. */
export const MAX_RELATIVE_HOURS = 24;

export interface FillTiming {
  fireAt: Date;
  fireDate: string; // 'YYYY-MM-DD' no fuso do app (GMT-3)
}

/**
 * Horário de disparo de um arm: `null` = âncora (próxima 08:30 GMT-3, ADR-0008);
 * número = hora+N relativo à criação (inteiro 0–24; 0 = "o quanto antes", isto é,
 * o próximo tick do poller). O fire_date é sempre a data GMT-3 do disparo — um N
 * que atravessa a meia-noite conta como fill do dia seguinte.
 */
export function computeFillTiming(after: Date, hoursFromNow: number | null | undefined): FillTiming {
  if (hoursFromNow === null || hoursFromNow === undefined) {
    return nextDailyRunAfter(after, FILL_HOUR, FILL_MINUTE);
  }
  if (!Number.isInteger(hoursFromNow) || hoursFromNow < 0 || hoursFromNow > MAX_RELATIVE_HOURS) {
    throw new Error(`Horas inválidas: ${hoursFromNow} — esperado inteiro entre 0 e ${MAX_RELATIVE_HOURS}.`);
  }
  const fireAt = new Date(after.getTime() + hoursFromNow * 3_600_000);
  return { fireAt, fireDate: todayStr(fireAt) };
}

/** A unicidade legada bloqueava re-arm o dia inteiro mesmo após um fill done —
 *  um no-op silencioso (docs/adr/0010). Derrubada em favor do índice parcial. */
export const LEGACY_UNIQ_DROP_SQL = `
  ALTER TABLE catalog_video_fills
    DROP CONSTRAINT IF EXISTS catalog_video_fills_catalog_id_fire_date_key
`;

/** Dedup status-aware: no máximo UM fill PENDENTE por (catálogo, dia).
 *  done/failed/canceled nunca bloqueiam um novo arm. */
export const PENDING_UNIQ_INDEX_SQL = `
  CREATE UNIQUE INDEX IF NOT EXISTS catalog_video_fills_pending_uniq
    ON catalog_video_fills (catalog_id, fire_date)
    WHERE status = 'pending'
`;

export interface ArmQueryClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: any[] }>;
}

export interface ArmParams {
  catalogId: string;
  catalogName: string | null;
  armedBy: string | null;
  fireAt: Date;
  fireDate: string;
}

export interface ArmResult<F = any> {
  armed: boolean;
  /** true quando o arm moveu o pendente do dia para um horário MAIS CEDO. */
  reanchored: boolean;
  fill: F;
}

// O arbiter precisa casar com o índice parcial: só pendentes conflitam.
const ARM_INSERT_SQL = `
  INSERT INTO catalog_video_fills (catalog_id, catalog_name, fire_date, fire_at, armed_by)
  VALUES ($1, $2, $3::date, $4, $5)
  ON CONFLICT (catalog_id, fire_date) WHERE status = 'pending' DO NOTHING
  RETURNING *
`;

// Re-ancoragem "mais cedo vence": só move um pendente para ANTES, nunca adia.
const REANCHOR_UPDATE_SQL = `
  UPDATE catalog_video_fills
     SET fire_at = $3, armed_by = COALESCE($4, armed_by), armed_at = now()
   WHERE catalog_id = $1 AND fire_date = $2::date AND status = 'pending' AND fire_at > $3
   RETURNING *
`;

const PENDING_SELECT_SQL = `
  SELECT * FROM catalog_video_fills
   WHERE catalog_id = $1 AND fire_date = $2::date AND status = 'pending'
`;

/**
 * Arm com dedup status-aware (docs/adr/0010): INSERT novo pendente → se já há
 * pendente no dia, re-ancora para o mais cedo → senão devolve o pendente vigente
 * (no-op). Se o pendente sumir entre as queries (claimed/cancelado), volta ao
 * INSERT — poucas voltas bastam; corrida persistente lança em vez de girar.
 */
export async function runArmVideoFill<F = any>(
  client: ArmQueryClient,
  p: ArmParams,
): Promise<ArmResult<F>> {
  const fireAtIso = p.fireAt.toISOString();
  for (let attempt = 0; attempt < 3; attempt++) {
    const ins = await client.query(ARM_INSERT_SQL, [p.catalogId, p.catalogName, p.fireDate, fireAtIso, p.armedBy]);
    if (ins.rows[0]) return { armed: true, reanchored: false, fill: ins.rows[0] };
    const upd = await client.query(REANCHOR_UPDATE_SQL, [p.catalogId, p.fireDate, fireAtIso, p.armedBy]);
    if (upd.rows[0]) return { armed: true, reanchored: true, fill: upd.rows[0] };
    const sel = await client.query(PENDING_SELECT_SQL, [p.catalogId, p.fireDate]);
    if (sel.rows[0]) return { armed: false, reanchored: false, fill: sel.rows[0] };
  }
  throw new Error('Não foi possível armar o preenchimento (corrida persistente na fila de fills).');
}
