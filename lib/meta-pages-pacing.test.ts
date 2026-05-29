import { describe, it, expect } from 'vitest';
import { computeBackoffMs, usagePctFromResponse, Pacer } from './meta-pages-pacing';

describe('computeBackoffMs', () => {
  it('is near-zero when usage is low', () => {
    expect(computeBackoffMs(0)).toBe(0);
    expect(computeBackoffMs(49)).toBe(0);
  });
  it('ramps up as usage climbs', () => {
    expect(computeBackoffMs(60)).toBe(500);
    expect(computeBackoffMs(80)).toBe(2000);
    expect(computeBackoffMs(90)).toBe(8000);
  });
  it('pauses hard near the ceiling', () => {
    expect(computeBackoffMs(96)).toBe(30000);
    expect(computeBackoffMs(100)).toBe(30000);
  });
});

// Minimal Response stand-in carrying only the headers we read.
function resWith(headers: Record<string, string>): Response {
  return new Response(null, { headers });
}

describe('usagePctFromResponse', () => {
  it('returns 0 when no usage headers present', () => {
    expect(usagePctFromResponse(resWith({}))).toBe(0);
  });
  it('takes the max across app-usage metrics', () => {
    const r = resWith({ 'x-app-usage': JSON.stringify({ call_count: 10, total_cputime: 73, total_time: 20 }) });
    expect(usagePctFromResponse(r)).toBe(73);
  });
  it('takes the max across nested BUC / ad-account usage', () => {
    const r = resWith({
      'x-app-usage': JSON.stringify({ call_count: 5 }),
      'x-business-use-case-usage': JSON.stringify({ '123': [{ call_count: 88 }] }),
    });
    expect(usagePctFromResponse(r)).toBe(88);
  });
});

describe('Pacer', () => {
  it('starts at zero delay and tracks the last recorded usage', () => {
    const p = new Pacer();
    expect(p.delayMs()).toBe(0);
    p.record(resWith({ 'x-app-usage': JSON.stringify({ call_count: 90 }) }));
    expect(p.delayMs()).toBe(8000);
  });
});
