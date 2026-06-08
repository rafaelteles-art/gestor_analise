import { describe, it, expect } from 'vitest';
import { matchRtCampaignCost, type RtAgg } from './redtrack-cost';

const agg = (total_revenue: number, convtype2: number, cost: number): RtAgg =>
  ({ total_revenue, convtype2, cost });

describe('matchRtCampaignCost', () => {
  it('soma por sub3 (campaign_id) quando há hit, ignorando o nome', () => {
    const bySub3 = new Map<string, RtAgg>([
      ['111', agg(100, 2, 30)],
      ['222', agg(50, 1, 20)],
    ]);
    const byName = new Map<string, RtAgg>([['Campanha X', agg(999, 9, 999)]]);
    const res = matchRtCampaignCost(
      { campaign_ids: ['111', '222'], campaign_name: 'Campanha X' },
      bySub3,
      byName,
    );
    expect(res).toEqual({ total_revenue: 150, convtype2: 3, cost: 50 });
  });

  it('cai para match por nome exato quando nenhum sub3 bate', () => {
    const bySub3 = new Map<string, RtAgg>();
    const byName = new Map<string, RtAgg>([['Campanha X', agg(80, 4, 25)]]);
    const res = matchRtCampaignCost(
      { campaign_ids: ['999'], campaign_name: 'Campanha X' },
      bySub3,
      byName,
    );
    expect(res).toEqual({ total_revenue: 80, convtype2: 4, cost: 25 });
  });

  it('faz match parcial por nome contido (rtName length > 10)', () => {
    const bySub3 = new Map<string, RtAgg>();
    const byName = new Map<string, RtAgg>([['Oferta Emagrecedor', agg(40, 1, 12)]]);
    const res = matchRtCampaignCost(
      { campaign_ids: [], campaign_name: 'ATIVAR - Oferta Emagrecedor - CBO' },
      bySub3,
      byName,
    );
    expect(res).toEqual({ total_revenue: 40, convtype2: 1, cost: 12 });
  });

  it('NÃO faz match parcial quando o nome RT é curto (<= 10)', () => {
    const bySub3 = new Map<string, RtAgg>();
    const byName = new Map<string, RtAgg>([['Curto', agg(40, 1, 12)]]);
    const res = matchRtCampaignCost(
      { campaign_ids: [], campaign_name: 'ATIVAR - Curto - CBO' },
      bySub3,
      byName,
    );
    expect(res).toBeNull();
  });

  it('soma múltiplos sub3 e evita contagem dupla do custo da campanha inteira', () => {
    const bySub3 = new Map<string, RtAgg>([
      ['111', agg(60, 1, 18)],
      ['112', agg(60, 1, 18)],
    ]);
    const byName = new Map<string, RtAgg>([['Mesma Campanha', agg(120, 2, 99)]]);
    const res = matchRtCampaignCost(
      { campaign_ids: ['111', '112'], campaign_name: 'Mesma Campanha' },
      bySub3,
      byName,
    );
    expect(res).toEqual({ total_revenue: 120, convtype2: 2, cost: 36 });
  });

  it('retorna null quando não há match algum', () => {
    const res = matchRtCampaignCost(
      { campaign_ids: ['x'], campaign_name: 'Inexistente' },
      new Map(),
      new Map(),
    );
    expect(res).toBeNull();
  });
});
