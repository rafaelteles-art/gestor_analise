import { describe, it, expect } from 'vitest';
import { tokensForAccount, selectProfiles, foldAdsVolumeRows } from './meta-pages';

describe('tokensForAccount', () => {
  const map = new Map([['P142', 'tokA'], ['106 v2', 'tokB']]);

  it('returns tokens for the accessible profiles, in order', () => {
    expect(tokensForAccount(['P142', '106 v2'], map)).toEqual(['tokA', 'tokB']);
  });
  it('skips profiles with no live token', () => {
    expect(tokensForAccount(['ghost', 'P142'], map)).toEqual(['tokA']);
  });
  it('returns empty when nothing matches', () => {
    expect(tokensForAccount([], map)).toEqual([]);
    expect(tokensForAccount(['ghost'], map)).toEqual([]);
  });
  it('dedupes repeated tokens', () => {
    const m2 = new Map([['a', 'tok'], ['b', 'tok']]);
    expect(tokensForAccount(['a', 'b'], m2)).toEqual(['tok']);
  });
});

describe('selectProfiles', () => {
  const all = [
    { name: 'P251', token: 't251' },
    { name: 'p133', token: 't133' },
    { name: 'Ghost', token: '' }, // no live token
  ];

  it('returns all profiles with a token when no names given', () => {
    expect(selectProfiles(all).map((p) => p.name)).toEqual(['P251', 'p133']);
    expect(selectProfiles(all, []).map((p) => p.name)).toEqual(['P251', 'p133']);
  });
  it('filters to the requested names, case/space-insensitive', () => {
    expect(selectProfiles(all, [' p251 ']).map((p) => p.name)).toEqual(['P251']);
    expect(selectProfiles(all, ['P133', 'P251']).map((p) => p.name)).toEqual(['P251', 'p133']);
  });
  it('never returns a profile without a live token', () => {
    expect(selectProfiles(all, ['Ghost'])).toEqual([]);
  });
  it('ignores names that match nothing', () => {
    expect(selectProfiles(all, ['nope'])).toEqual([]);
  });
});

describe('foldAdsVolumeRows', () => {
  it('keeps MAX limit and MAX running per actor across rows', () => {
    const { limits, running, names } = foldAdsVolumeRows([
      { actor_id: 'A', actor_name: 'Page A', limit_on_ads_running_or_in_review: 250, ads_running_or_in_review_count: 10 },
      { actor_id: 'A', limit_on_ads_running_or_in_review: 1000, ads_running_or_in_review_count: 7 },
      { actor_id: 'B', actor_name: 'Page B', limit_on_ads_running_or_in_review: 250, ads_running_or_in_review_count: 3 },
    ]);
    expect(limits.get('A')).toBe(1000);
    expect(running.get('A')).toBe(10);
    expect(limits.get('B')).toBe(250);
    expect(names.get('A')).toBe('Page A');
  });
  it('accumulates into an existing accumulator (multi-account merge)', () => {
    const acc = foldAdsVolumeRows([{ actor_id: 'A', limit_on_ads_running_or_in_review: 250, ads_running_or_in_review_count: 5 }]);
    foldAdsVolumeRows([{ actor_id: 'A', limit_on_ads_running_or_in_review: 100, ads_running_or_in_review_count: 9 }], acc);
    expect(acc.limits.get('A')).toBe(250); // MAX, not overwritten by the smaller later value
    expect(acc.running.get('A')).toBe(9);
  });
  it('ignores rows without actor_id and missing numeric fields', () => {
    const { limits, running } = foldAdsVolumeRows([
      { actor_name: 'no id' },
      { actor_id: 'C' }, // no numbers
    ]);
    expect(limits.has('C')).toBe(false);
    expect(running.has('C')).toBe(false);
  });
});
