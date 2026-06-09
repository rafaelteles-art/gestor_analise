/**
 * Fuso horário ÚNICO do app: GMT-3 (Brasil).
 *
 * Usamos a zona IANA 'America/Sao_Paulo', que está fixa em UTC-3 desde que o
 * Brasil aboliu o horário de verão (2019). É exatamente o mesmo fuso já enviado
 * nas chamadas à API do RedTrack (`tz=America/Sao_Paulo`), então "hoje" no app
 * sempre coincide com "hoje" nos dados sincronizados.
 *
 * Por que isto existe: o runtime de produção (Firebase App Hosting / Cloud Run)
 * roda em UTC. `new Date()` + date-fns `format`/`subDays` produzem a data no
 * fuso do runtime — depois das 21h (horário de Brasília) isso já vira "amanhã"
 * em UTC, fazendo o sync/dashboard pegar o dia errado. As funções abaixo
 * calculam SEMPRE no fuso do app, rodem no servidor ou no browser.
 *
 * Regra: qualquer lugar que precise de data/hora deve usar este módulo, nunca
 * `new Date().toISOString().slice(...)` nem `format(new Date(), ...)` crus.
 */

export const APP_TIMEZONE = 'America/Sao_Paulo';

/** Offset fixo do fuso do app (sem DST). Usado para interpretar wall-clock. */
export const APP_UTC_OFFSET = '-03:00';

// 'en-CA' formata como YYYY-MM-DD.
const YMD_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// 'sv-SE' formata como 'YYYY-MM-DD HH:mm' (24h) — base para datetime-local.
const DATETIME_LOCAL_FMT = new Intl.DateTimeFormat('sv-SE', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** 'YYYY-MM-DD' de uma data (default: agora) no fuso do app. */
export function todayStr(d: Date = new Date()): string {
  return YMD_FMT.format(d);
}

/**
 * 'YYYY-MM-DD' de N dias atrás (no fuso do app).
 * GMT-3 não tem DST, então subtrair dias em ms é exato para a parte de data.
 */
export function daysAgoStr(n: number, from: Date = new Date()): string {
  return todayStr(new Date(from.getTime() - n * 86_400_000));
}

/** Ano/mês/dia (strings zero-padded) no fuso do app. */
export function nowParts(d: Date = new Date()): { year: string; month: string; day: string } {
  const [year, month, day] = todayStr(d).split('-');
  return { year, month, day };
}

/**
 * Valor para `<input type="datetime-local">` ('YYYY-MM-DDTHH:mm') refletindo
 * o relógio de parede do fuso do app.
 */
export function toDatetimeLocal(d: Date = new Date()): string {
  return DATETIME_LOCAL_FMT.format(d).replace(' ', 'T');
}

/**
 * Interpreta uma string de datetime-local ('YYYY-MM-DDTHH:mm') como horário do
 * fuso do app e devolve o instante em ISO UTC (com 'Z'). Robusto a qualquer
 * fuso do browser, pois fixa o offset GMT-3 explicitamente.
 */
export function datetimeLocalToISO(local: string): string {
  const withSeconds = local.length === 16 ? `${local}:00` : local;
  return new Date(`${withSeconds}${APP_UTC_OFFSET}`).toISOString();
}

/** Formata data + hora em pt-BR no fuso do app. */
export function fmtDateTime(
  value: Date | string | number,
  opts: Intl.DateTimeFormatOptions = {},
): string {
  return new Date(value).toLocaleString('pt-BR', { timeZone: APP_TIMEZONE, ...opts });
}

/** Formata apenas a data em pt-BR no fuso do app. */
export function fmtDate(
  value: Date | string | number,
  opts: Intl.DateTimeFormatOptions = {},
): string {
  return new Date(value).toLocaleDateString('pt-BR', { timeZone: APP_TIMEZONE, ...opts });
}

/** Formata apenas o horário em pt-BR no fuso do app. */
export function fmtTime(
  value: Date | string | number,
  opts: Intl.DateTimeFormatOptions = {},
): string {
  return new Date(value).toLocaleTimeString('pt-BR', { timeZone: APP_TIMEZONE, ...opts });
}
