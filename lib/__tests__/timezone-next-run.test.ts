import { describe, it, expect } from 'vitest';
import { nextDailyRunAfter } from '../timezone';

// 08:30 America/Sao_Paulo == 11:30:00Z (fixed -03:00, no DST).
const at0830 = (isoDate: string) => new Date(`${isoDate}T08:30:00-03:00`).getTime();

describe('nextDailyRunAfter (08:30 GMT-3)', () => {
  it('returns today 08:30 when called before it', () => {
    const r = nextDailyRunAfter(new Date('2026-07-02T05:00:00-03:00'), 8, 30);
    expect(r.fireDate).toBe('2026-07-02');
    expect(r.fireAt.getTime()).toBe(at0830('2026-07-02'));
  });

  it('rolls to tomorrow when called after today 08:30', () => {
    const r = nextDailyRunAfter(new Date('2026-07-02T15:00:00-03:00'), 8, 30);
    expect(r.fireDate).toBe('2026-07-03');
    expect(r.fireAt.getTime()).toBe(at0830('2026-07-03'));
  });

  it('rolls to tomorrow when exactly at 08:30 (strictly after)', () => {
    const r = nextDailyRunAfter(new Date('2026-07-02T08:30:00-03:00'), 8, 30);
    expect(r.fireDate).toBe('2026-07-03');
    expect(r.fireAt.getTime()).toBe(at0830('2026-07-03'));
  });

  it('handles a late-night arm rolling to the next calendar day', () => {
    const r = nextDailyRunAfter(new Date('2026-07-02T23:59:00-03:00'), 8, 30);
    expect(r.fireDate).toBe('2026-07-03');
    expect(r.fireAt.getTime()).toBe(at0830('2026-07-03'));
  });
});
