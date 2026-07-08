import { describe, it, expect } from 'vitest';
import {
  isItemsBatchRequiredError,
  formatItemsBatchPrice,
  buildItemsBatchCreateData,
  ITEMS_BATCH_ITEM_TYPE,
} from './meta-catalog-items-batch';

describe('ITEMS_BATCH_ITEM_TYPE', () => {
  // Regressão: a mensagem da Meta diz "OTHER", mas OTHER é rejeitado ao vivo.
  // PRODUCT_ITEM é o único aceito (v21/v23/v25). Ver doc do módulo.
  it('é PRODUCT_ITEM, NUNCA OTHER', () => {
    expect(ITEMS_BATCH_ITEM_TYPE).toBe('PRODUCT_ITEM');
    expect(ITEMS_BATCH_ITEM_TYPE).not.toBe('OTHER');
  });
});

describe('isItemsBatchRequiredError', () => {
  const realErr = {
    step: 'createProduct',
    code: 100,
    message:
      '(#100) This catalog contains other items. Use the items_batch endpoint with item_type=OTHER to create items in this catalog. — (code 100 · trace AuCjRqI3_5btZUUgWvH9ZKZ)',
    raw: {
      message:
        'This catalog contains other items. Use the items_batch endpoint with item_type=OTHER to create items in this catalog.',
      code: 100,
    },
  };

  it('detecta o erro real da Meta', () => {
    expect(isItemsBatchRequiredError(realErr)).toBe(true);
  });

  it('detecta a partir de um erro cru da Graph API (sem .raw aninhado)', () => {
    expect(
      isItemsBatchRequiredError({
        code: 100,
        message: 'Use the items_batch endpoint with item_type=OTHER',
      }),
    ).toBe(true);
  });

  it('detecta via error_user_msg', () => {
    expect(
      isItemsBatchRequiredError({ code: 100, error_user_msg: 'Esse catálogo contains other items.' }),
    ).toBe(true);
  });

  it('NÃO casa com outros erros #100 (ex: campo inexistente)', () => {
    expect(
      isItemsBatchRequiredError({
        code: 100,
        message: "(#100) Tried accessing nonexisting field (adtrust_dsl) on node type 'AdAccount'",
      }),
    ).toBe(false);
  });

  it('NÃO casa quando code != 100 mesmo mencionando items_batch', () => {
    expect(isItemsBatchRequiredError({ code: 190, message: 'items_batch item_type=OTHER' })).toBe(false);
  });

  it('é seguro para entradas inválidas', () => {
    expect(isItemsBatchRequiredError(null)).toBe(false);
    expect(isItemsBatchRequiredError(undefined)).toBe(false);
    expect(isItemsBatchRequiredError('erro')).toBe(false);
    expect(isItemsBatchRequiredError(42)).toBe(false);
  });
});

describe('formatItemsBatchPrice', () => {
  it('formata com 2 casas + moeda ISO uppercase', () => {
    expect(formatItemsBatchPrice(97, 'brl')).toBe('97.00 BRL');
    expect(formatItemsBatchPrice(9.9, 'USD')).toBe('9.90 USD');
    expect(formatItemsBatchPrice(0, 'BRL')).toBe('0.00 BRL');
  });

  it('trata valores inválidos como string vazia', () => {
    expect(formatItemsBatchPrice(-1, 'BRL')).toBe('');
    expect(formatItemsBatchPrice(NaN, 'BRL')).toBe('');
    expect(formatItemsBatchPrice(Infinity, 'BRL')).toBe('');
  });

  it('omite moeda vazia sem quebrar', () => {
    expect(formatItemsBatchPrice(10, '')).toBe('10.00');
  });
});

describe('buildItemsBatchCreateData', () => {
  it('mapeia para os nomes de campo do feed (title/link/image_link)', () => {
    const data = buildItemsBatchCreateData({
      retailerId: 'LT1100 07/07',
      title: 'Meu Produto',
      price: '97.00 BRL',
      link: 'https://ex.com/p',
      imageLink: 'https://ex.com/i.jpg',
      description: 'desc',
      brand: 'Acme',
      availability: 'in stock',
      condition: 'new',
    });
    expect(data).toEqual({
      id: 'LT1100 07/07',
      title: 'Meu Produto',
      price: '97.00 BRL',
      link: 'https://ex.com/p',
      image_link: 'https://ex.com/i.jpg',
      description: 'desc',
      brand: 'Acme',
      availability: 'in stock',
      condition: 'new',
    });
    expect(data).not.toHaveProperty('name');
    expect(data).not.toHaveProperty('url');
    expect(data).not.toHaveProperty('image_url');
    expect(data).not.toHaveProperty('currency');
  });

  it('omite opcionais vazios mas mantém os obrigatórios', () => {
    const data = buildItemsBatchCreateData({
      retailerId: 'X 07/07',
      title: 'T',
      price: '0.00 BRL',
      link: 'https://ex.com',
      imageLink: 'https://ex.com/i.jpg',
      description: '',
      brand: '   ',
      availability: 'in stock',
      condition: 'new',
    });
    expect(data).not.toHaveProperty('description');
    expect(data).not.toHaveProperty('brand');
    expect(Object.keys(data).sort()).toEqual(
      ['availability', 'condition', 'id', 'image_link', 'link', 'price', 'title'].sort(),
    );
  });
});
