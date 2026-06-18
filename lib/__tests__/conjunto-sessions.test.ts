import { describe, it, expect } from 'vitest';
import {
  initDraft,
  recordSuccess,
  sessionItems,
  hasResults,
  copyIdsText,
  copyIdNameText,
  type SessionDraft,
} from '../conjunto-sessions';

const BASE = { session_id: 's1', catalog_id: 'cat1', bm_id: 'bm1' };

function ok(ad_name: string, n: string) {
  return {
    ad_name,
    product_set_id: `set_${n}`,
    retailer_id: `ret_${n}`,
    product_id: `prod_${n}`,
    product_name: `Produto ${n}`,
  };
}

describe('initDraft', () => {
  it('cria um slot por nome com orderIndex = linha original e result null', () => {
    const d = initDraft({ ...BASE, adNames: ['a', 'b', 'c'] });
    expect(d.session_id).toBe('s1');
    expect(d.slots.map((s) => [s.orderIndex, s.ad_name, s.result])).toEqual([
      [0, 'a', null],
      [1, 'b', null],
      [2, 'c', null],
    ]);
  });
});

describe('recordSuccess', () => {
  it('preenche o slot do ad_name correspondente sem mutar o draft original', () => {
    const d0 = initDraft({ ...BASE, adNames: ['a', 'b'] });
    const d1 = recordSuccess(d0, ok('a', '1'));
    expect(d0.slots[0].result).toBeNull(); // imutável
    expect(d1.slots[0].result?.product_set_id).toBe('set_1');
    expect(d1.slots[1].result).toBeNull();
  });

  it('mantém a ordem ORIGINAL quando um retry preenche um buraco', () => {
    // colar original: a, b, c. 1ª passada: a e c ok, b falha.
    let d = initDraft({ ...BASE, adNames: ['a', 'b', 'c'] });
    d = recordSuccess(d, ok('a', '1'));
    d = recordSuccess(d, ok('c', '3'));
    expect(sessionItems(d).map((i) => i.ad_name)).toEqual(['a', 'c']);
    // retry: b agora dá certo → entra no buraco do meio, não no fim.
    d = recordSuccess(d, ok('b', '2'));
    expect(sessionItems(d).map((i) => i.ad_name)).toEqual(['a', 'b', 'c']);
    expect(sessionItems(d).map((i) => i.orderIndex)).toEqual([0, 1, 2]);
  });

  it('com ad_name duplicado, preenche o primeiro slot vazio correspondente', () => {
    let d = initDraft({ ...BASE, adNames: ['a', 'a', 'b'] });
    d = recordSuccess(d, ok('a', 'first'));
    expect(d.slots[0].result?.product_set_id).toBe('set_first');
    expect(d.slots[1].result).toBeNull();
    d = recordSuccess(d, ok('a', 'second'));
    expect(d.slots[1].result?.product_set_id).toBe('set_second');
  });

  it('nome que não existia no colar original é anexado no fim com novo orderIndex', () => {
    let d = initDraft({ ...BASE, adNames: ['a', 'b'] });
    d = recordSuccess(d, ok('novo', 'x'));
    const items = sessionItems(d);
    expect(items.map((i) => i.ad_name)).toEqual(['novo']);
    expect(items[0].orderIndex).toBe(2);
  });
});

describe('sessionItems', () => {
  it('retorna só os slots com result, ordenados por orderIndex', () => {
    let d = initDraft({ ...BASE, adNames: ['a', 'b', 'c'] });
    d = recordSuccess(d, ok('c', '3'));
    d = recordSuccess(d, ok('a', '1'));
    expect(sessionItems(d)).toEqual([
      { orderIndex: 0, ad_name: 'a', product_set_id: 'set_1', retailer_id: 'ret_1', product_id: 'prod_1', product_name: 'Produto 1' },
      { orderIndex: 2, ad_name: 'c', product_set_id: 'set_3', retailer_id: 'ret_3', product_id: 'prod_3', product_name: 'Produto 3' },
    ]);
  });
});

describe('hasResults', () => {
  it('false quando nada foi criado (não salvar sessão de 0 sucessos)', () => {
    const d = initDraft({ ...BASE, adNames: ['a', 'b'] });
    expect(hasResults(d)).toBe(false);
  });
  it('true após ao menos um sucesso', () => {
    const d = recordSuccess(initDraft({ ...BASE, adNames: ['a'] }), ok('a', '1'));
    expect(hasResults(d)).toBe(true);
  });
});

describe('copy helpers', () => {
  const items = [
    { orderIndex: 0, ad_name: 'a', product_set_id: 'set_1', retailer_id: 'ret_1', product_id: 'prod_1', product_name: 'P1' },
    { orderIndex: 1, ad_name: 'b', product_set_id: 'set_2', retailer_id: 'ret_2', product_id: 'prod_2', product_name: 'P2' },
  ];
  it('copyIdsText = um product_set_id por linha', () => {
    expect(copyIdsText(items)).toBe('set_1\nset_2');
  });
  it('copyIdNameText = product_set_id<TAB>ad_name por linha', () => {
    expect(copyIdNameText(items)).toBe('set_1\ta\nset_2\tb');
  });
});
