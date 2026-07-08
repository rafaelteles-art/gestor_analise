import { describe, it, expect } from 'vitest';
import {
  isBuilderSnapshot,
  reopenSchedule,
  type BuilderSnapshot,
} from '../builder-snapshot';

// Builder Snapshot (ver CONTEXT.md): estado do formulário congelado no enqueue,
// gravado no payload de cada Campaign Job para o Reopen ("Reabrir no builder").

function validSnapshot(): BuilderSnapshot {
  return {
    v: 1,
    profile_name: 'P234',
    account_ids: ['act_1', 'act_2'],
    page_ids: ['111'],
    page_allocations: { '111': 4 },
    ads: [
      {
        id: 'a1',
        name: 'LT1100',
        image_hash: '',
        video_id: 'v123',
        video_thumbnail_url: 'https://cdn/thumb.jpg',
        media_kind: 'video',
        product_set_id: '',
      },
    ],
    creative_groups: { names: ['Grupo 1'], byId: { a1: 0 } },
    shared_copy: { message: 'oi' },
    schedule: { start: '2026-07-07T16:00', end: '', has_end: false },
    schedule_video_fill: false,
    config: { campaignType: 'ABO' },
  };
}

describe('isBuilderSnapshot', () => {
  it('accepts a valid v1 snapshot', () => {
    expect(isBuilderSnapshot(validSnapshot())).toBe(true);
  });

  it('rejects null, undefined and non-objects', () => {
    expect(isBuilderSnapshot(null)).toBe(false);
    expect(isBuilderSnapshot(undefined)).toBe(false);
    expect(isBuilderSnapshot('snapshot')).toBe(false);
    expect(isBuilderSnapshot(42)).toBe(false);
  });

  it('rejects unknown versions', () => {
    expect(isBuilderSnapshot({ ...validSnapshot(), v: 2 })).toBe(false);
  });

  it('rejects snapshots without accounts', () => {
    expect(isBuilderSnapshot({ ...validSnapshot(), account_ids: [] })).toBe(false);
    const { account_ids: _drop, ...rest } = validSnapshot();
    expect(isBuilderSnapshot(rest)).toBe(false);
  });

  it('rejects snapshots without ads or with malformed ads', () => {
    expect(isBuilderSnapshot({ ...validSnapshot(), ads: [] })).toBe(false);
    expect(isBuilderSnapshot({ ...validSnapshot(), ads: [{ name: 'sem id' }] })).toBe(false);
  });

  it('rejects snapshots missing config, groups or schedule', () => {
    expect(isBuilderSnapshot({ ...validSnapshot(), config: null })).toBe(false);
    expect(isBuilderSnapshot({ ...validSnapshot(), creative_groups: { names: 'x' } })).toBe(false);
    expect(isBuilderSnapshot({ ...validSnapshot(), schedule: {} })).toBe(false);
  });

  it('tolerates extra unknown fields (forward-compat)', () => {
    expect(isBuilderSnapshot({ ...validSnapshot(), futuro: true })).toBe(true);
  });
});

describe('reopenSchedule', () => {
  // 15:00 GMT-3 — toDatetimeLocal formata no fuso do app independente do TZ da máquina.
  const now = new Date('2026-07-07T15:00:00-03:00');

  it('keeps a future start exactly', () => {
    const r = reopenSchedule({ start: '2026-07-09T10:30', end: '', has_end: false }, now);
    expect(r.start).toBe('2026-07-09T10:30');
  });

  it('resets a past start to the builder default (now + 1h)', () => {
    const r = reopenSchedule({ start: '2026-07-01T08:00', end: '', has_end: false }, now);
    expect(r.start).toBe('2026-07-07T16:00');
  });

  it('treats start == now as past (Meta rejects non-future starts)', () => {
    const r = reopenSchedule({ start: '2026-07-07T15:00', end: '', has_end: false }, now);
    expect(r.start).toBe('2026-07-07T16:00');
  });

  it('resets an empty start to the builder default', () => {
    const r = reopenSchedule({ start: '', end: '', has_end: false }, now);
    expect(r.start).toBe('2026-07-07T16:00');
  });

  it('keeps a future end when has_end', () => {
    const r = reopenSchedule(
      { start: '2026-07-09T10:30', end: '2026-07-20T23:59', has_end: true },
      now,
    );
    expect(r.has_end).toBe(true);
    expect(r.end).toBe('2026-07-20T23:59');
  });

  it('clears a past end', () => {
    const r = reopenSchedule(
      { start: '2026-07-09T10:30', end: '2026-07-05T23:59', has_end: true },
      now,
    );
    expect(r.has_end).toBe(false);
    expect(r.end).toBe('');
  });

  it('normalizes end when has_end is false', () => {
    const r = reopenSchedule(
      { start: '2026-07-09T10:30', end: '2026-07-20T23:59', has_end: false },
      now,
    );
    expect(r.has_end).toBe(false);
    expect(r.end).toBe('');
  });
});
