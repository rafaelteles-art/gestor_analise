import { describe, it, expect } from 'vitest';
import { expandBatch } from '../meta-campaigns';
import type { SeparationLevel } from '../batch-contract';

/**
 * F7 — separation-level grouping. Totals are ALWAYS N*C*S*A regardless of level;
 * only the grouping (and which entities are shared) changes. Cases use
 * N=3 creatives, C=1, S=2, A=1 (matches the ADR/plan examples).
 */
describe('expandBatch (separation grouping)', () => {
  const N = 3, C = 1, S = 2, A = 1;
  const TOTAL_ADS = N * C * S * A; // 6

  it("campaign level: N*C campaigns, each creative isolated (c:0:0, c:1:0, c:2:0)", () => {
    const { campaigns, adsets, ads } = expandBatch(N, C, S, A, 'campaign');
    expect(campaigns).toHaveLength(N * C); // 3
    expect(campaigns.map((c) => c.key)).toEqual(['c:0:0', 'c:1:0', 'c:2:0']);
    expect(campaigns.every((c) => c.creativeIdx !== null)).toBe(true);
    expect(adsets).toHaveLength(N * C * S); // 6
    expect(ads).toHaveLength(TOTAL_ADS); // 6
    // each campaign has exactly S adsets
    for (const c of campaigns) {
      expect(adsets.filter((s) => s.campKey === c.key)).toHaveLength(S);
    }
    // sample adset/ad key shapes
    expect(adsets.map((s) => s.key)).toContain('s:0:0:0');
    expect(ads.map((x) => x.key)).toContain('a:2:0:1:0');
  });

  it("adset level: C shared campaign (c:-:0) with N*S adsets", () => {
    const { campaigns, adsets, ads } = expandBatch(N, C, S, A, 'adset');
    expect(campaigns).toHaveLength(C); // 1
    expect(campaigns[0].key).toBe('c:-:0');
    expect(campaigns[0].creativeIdx).toBeNull();
    expect(adsets).toHaveLength(N * C * S); // 6
    // all adsets hang off the shared campaign
    expect(adsets.every((s) => s.campKey === 'c:-:0')).toBe(true);
    // each creative gets its own S adsets, keyed s:<cr>:<ci>:<si>
    expect(adsets.map((s) => s.key).sort()).toEqual(
      ['s:0:0:0', 's:0:0:1', 's:1:0:0', 's:1:0:1', 's:2:0:0', 's:2:0:1'].sort()
    );
    // _CJ suffix numbering is continuous within the shared campaign (1..6)
    expect(adsets.map((s) => s.setSuffixNum).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(ads).toHaveLength(TOTAL_ADS); // 6
  });

  it("ad level: C campaign, S shared adsets (s:-:0:0, s:-:0:1), N ads each", () => {
    const { campaigns, adsets, ads } = expandBatch(N, C, S, A, 'ad');
    expect(campaigns).toHaveLength(C); // 1
    expect(campaigns[0].key).toBe('c:-:0');
    expect(adsets).toHaveLength(C * S); // 2
    expect(adsets.map((s) => s.key)).toEqual(['s:-:0:0', 's:-:0:1']);
    expect(adsets.every((s) => s.creativeIdx === null)).toBe(true);
    expect(ads).toHaveLength(TOTAL_ADS); // 6
    // each shared adset holds N*A = 3 ads, one per creative
    for (const s of adsets) {
      const inAdset = ads.filter((x) => x.adsetKey === s.key);
      expect(inAdset).toHaveLength(N * A); // 3
      expect(inAdset.map((x) => x.creativeIdx).sort()).toEqual([0, 1, 2]);
      // _AD suffix numbering continuous within the adset (1..3)
      expect(inAdset.map((x) => x.adSuffixNum).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    }
    // ad key shape a:<cr>:<ci>:<si>:<ai>
    expect(ads.map((x) => x.key)).toContain('a:2:0:1:0');
  });

  it('totals are always N*C*S*A across all three levels', () => {
    const levels: SeparationLevel[] = ['campaign', 'adset', 'ad'];
    for (const level of levels) {
      const { ads } = expandBatch(N, C, S, A, level);
      expect(ads).toHaveLength(TOTAL_ADS);
    }
  });

  it('clamps zero/negative counters to 1 (defensive)', () => {
    const { campaigns, adsets, ads } = expandBatch(0, 0, 0, 0, 'campaign');
    expect(campaigns).toHaveLength(1);
    expect(adsets).toHaveLength(1);
    expect(ads).toHaveLength(1);
  });
});
