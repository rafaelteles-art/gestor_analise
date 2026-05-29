// Pacing for Meta Graph calls, steered by the three usage-header families Meta
// returns on every response:
//   x-app-usage               → whole-app quota (the "Limitação de volume" panel)
//   x-business-use-case-usage → per-BM / per-endpoint-use quota
//   x-ad-account-usage        → per-ad-account quota
// We slow down BEFORE hitting #4 instead of only reacting to the error.

type Usage = { call_count?: number; total_cputime?: number; total_time?: number };

function safeParse(v: string | null): unknown {
  if (!v) return null;
  try { return JSON.parse(v); } catch { return null; }
}

function maxFlat(u: unknown): number {
  if (!u || typeof u !== 'object') return 0;
  const x = u as Usage;
  return Math.max(Number(x.call_count ?? 0), Number(x.total_cputime ?? 0), Number(x.total_time ?? 0));
}

function maxNested(obj: unknown): number {
  if (!obj || typeof obj !== 'object') return 0;
  let max = 0;
  for (const arr of Object.values(obj as Record<string, unknown>)) {
    if (!Array.isArray(arr)) continue;
    for (const u of arr) max = Math.max(max, maxFlat(u));
  }
  return max;
}

/** Worst-case usage percentage (0–100) across all three header families. */
export function usagePctFromResponse(res: Response): number {
  return Math.max(
    maxFlat(safeParse(res.headers.get('x-app-usage'))),
    maxNested(safeParse(res.headers.get('x-business-use-case-usage'))),
    maxNested(safeParse(res.headers.get('x-ad-account-usage'))),
  );
}

/** Pure step function: usage% → delay before the next call. */
export function computeBackoffMs(pct: number): number {
  if (pct < 50) return 0;
  if (pct < 70) return 500;
  if (pct < 85) return 2000;
  if (pct < 95) return 8000;
  return 30000;
}

/** Stateful pacer: feed it each response, ask it how long to wait next. */
export class Pacer {
  private lastPct = 0;
  record(res: Response): void { this.lastPct = usagePctFromResponse(res); }
  delayMs(): number { return computeBackoffMs(this.lastPct); }
}
