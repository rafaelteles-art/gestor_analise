import { describe, it, expect } from 'vitest';
import {
  aggregateCreativeRows,
  aggregateCreativeWindows,
  aggregateMetaAdsByName,
  buildCreativeBreakdown,
  type Sub3AdRow,
  type CreativeMoney,
} from './creative-breakdown';

const row = (
  date: string,
  sub3: string,
  rt_ad: string,
  cost: number,
  total_revenue: number,
  convtype1 = 0,
  convtype2 = 0,
): Sub3AdRow => ({ date, sub3, rt_ad, cost, total_revenue, convtype1, convtype2 });

describe('aggregateCreativeRows', () => {
  it('agrupa por rt_ad somando só as linhas dos campaign_ids e do período', () => {
    const rows = [
      row('2026-07-08', 'A', 'LT1.1', 10, 100, 2, 1),
      row('2026-07-09', 'A', 'LT1.1', 5, 50, 1, 1),
      row('2026-07-09', 'B', 'LT1.1', 7, 0, 0, 0),   // outro campaign_id da MESMA linha (ABO)
      row('2026-07-09', 'ZZZ', 'LT1.1', 999, 999),   // fora do escopo — ignorada
      row('2026-07-01', 'A', 'LT1.1', 999, 999),     // fora do período — ignorada
    ];
    const out = aggregateCreativeRows(rows, ['A', 'B'], '2026-07-08', '2026-07-09');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      creative: 'LT1.1',
      untracked: false,
      cost: 22,
      revenue: 150,
      ic: 3,
      sales: 2,
      profit: 128,
    });
    expect(out[0].roas).toBeCloseTo(150 / 22);
    expect(out[0].cpa).toBeCloseTo(22 / 2);
  });

  it('ordena por cost desc, com a linha não-rastreada por último', () => {
    const rows = [
      row('2026-07-09', 'A', 'LT2.2', 5, 0),
      row('2026-07-09', 'A', 'LT1.1', 50, 0),
      row('2026-07-09', 'A', '', 100, 30), // rt_ad vazio com dinheiro → "(não rastreado)"
    ];
    const out = aggregateCreativeRows(rows, ['A'], '2026-07-09', '2026-07-09');
    expect(out.map((r) => r.creative)).toEqual(['LT1.1', 'LT2.2', '']);
    expect(out[2].untracked).toBe(true);
  });

  it('descarta a linha não-rastreada quando ela não tem dinheiro nem vendas', () => {
    const rows = [
      row('2026-07-09', 'A', 'LT1.1', 50, 0),
      row('2026-07-09', 'A', '', 0, 0, 3, 0), // só cliques/IC sem custo/receita/venda
    ];
    const out = aggregateCreativeRows(rows, ['A'], '2026-07-09', '2026-07-09');
    expect(out.map((r) => r.creative)).toEqual(['LT1.1']);
  });

  it('zera roas/cpa quando não há custo ou vendas', () => {
    const rows = [row('2026-07-09', 'A', 'LT1.1', 0, 10, 0, 0)];
    const out = aggregateCreativeRows(rows, ['A'], '2026-07-09', '2026-07-09');
    expect(out[0].roas).toBe(0);
    expect(out[0].cpa).toBe(0);
  });
});

describe('aggregateCreativeWindows', () => {
  it('soma por criativo em cada janela (date >= dateFrom da janela)', () => {
    const rows = [
      row('2026-07-09', 'A', 'LT1.1', 10, 100, 0, 1), // hoje
      row('2026-07-08', 'A', 'LT1.1', 20, 0, 0, 0),   // ontem
      row('2026-07-03', 'B', 'LT1.1', 30, 60, 0, 2),  // 7d atrás
    ];
    const ranges = [
      { label: 'Hoje', dateFrom: '2026-07-09' },
      { label: '2D', dateFrom: '2026-07-08' },
      { label: '7D', dateFrom: '2026-07-03' },
    ];
    const out = aggregateCreativeWindows(rows, ['A', 'B'], ranges);
    expect(out['LT1.1']['Hoje']).toMatchObject({ cost: 10, revenue: 100, profit: 90, sales: 1 });
    expect(out['LT1.1']['2D']).toMatchObject({ cost: 30, revenue: 100 });
    expect(out['LT1.1']['7D']).toMatchObject({ cost: 60, revenue: 160, sales: 3 });
    expect(out['LT1.1']['7D'].roas).toBeCloseTo(160 / 60);
    expect(out['LT1.1']['7D'].cpa).toBeCloseTo(60 / 3);
  });

  it('ignora linhas de campaign_ids fora do escopo', () => {
    const rows = [
      row('2026-07-09', 'A', 'LT1.1', 10, 0),
      row('2026-07-09', 'ZZZ', 'LT1.1', 99, 0),
    ];
    const out = aggregateCreativeWindows(rows, ['A'], [{ label: 'Hoje', dateFrom: '2026-07-09' }]);
    expect(out['LT1.1']['Hoje'].cost).toBe(10);
  });
});

describe('aggregateMetaAdsByName', () => {
  it('soma cópias do mesmo ad_name e deriva ctr/cpm ponderados', () => {
    const rows = [
      { ad_name: 'LT1.1', spend: 1, impressions: 100, clicks: 2 },
      { ad_name: 'LT1.1', spend: 3, impressions: 300, clicks: 4 },
      { ad_name: 'LT2.2', spend: 5, impressions: 0, clicks: 0 },
    ];
    const out = aggregateMetaAdsByName(rows, 2); // usdToBrl = 2
    const lt1 = out.get('LT1.1')!;
    expect(lt1.spend).toBe(4);
    expect(lt1.impressions).toBe(400);
    expect(lt1.ctr).toBeCloseTo((6 / 400) * 100);
    expect(lt1.cpm).toBeCloseTo((4 / 400) * 1000 * 2); // convertido p/ BRL
    const lt2 = out.get('LT2.2')!;
    expect(lt2.ctr).toBe(0);
    expect(lt2.cpm).toBe(0);
  });
});

describe('buildCreativeBreakdown', () => {
  const money = (creative: string, cost: number, untracked = false): CreativeMoney => ({
    creative, untracked, cost, revenue: 0, sales: 0, ic: 0, profit: -cost, roas: 0, cpa: 0,
  });

  it('junta lado Meta por nome exato e mantém criativos só-RT', () => {
    const rt = [money('LT1.1', 50), money('LT2.2', 5)];
    const meta = new Map([['LT1.1', { spend: 4, impressions: 400, clicks: 6, ctr: 1.5, cpm: 20 }]]);
    const out = buildCreativeBreakdown(rt, meta);
    expect(out[0]).toMatchObject({ creative: 'LT1.1', cost: 50, ctr: 1.5, cpm: 20, impressions: 400 });
    expect(out[1]).toMatchObject({ creative: 'LT2.2', cost: 5, ctr: null, cpm: null, impressions: null });
  });

  it('acrescenta criativos só-Meta com dinheiro zerado, antes da não-rastreada', () => {
    const rt = [money('LT1.1', 50), money('', 10, true)];
    const meta = new Map([
      ['LT1.1', { spend: 4, impressions: 400, clicks: 6, ctr: 1.5, cpm: 20 }],
      ['LT9.9', { spend: 2, impressions: 200, clicks: 1, ctr: 0.5, cpm: 10 }],
    ]);
    const out = buildCreativeBreakdown(rt, meta);
    expect(out.map((r) => r.creative)).toEqual(['LT1.1', 'LT9.9', '']);
    expect(out[1]).toMatchObject({ cost: 0, revenue: 0, sales: 0, ctr: 0.5, cpm: 10 });
    expect(out[2].untracked).toBe(true);
  });
});
