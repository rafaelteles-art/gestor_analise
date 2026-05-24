import { NextResponse } from 'next/server';
import { createProductWithSetUsingToken, type ProductPresetConfig } from '@/lib/meta-product-catalogs';
import { resolveAuth } from '../_helpers';

export const dynamic = 'force-dynamic';

/**
 * POST /api/campaigns/products
 * Body: { account_id, profile_name?, catalog_id, ad_name, product_name, link, image_url, price?, currency? }
 *
 * Cria um produto + product set no catálogo informado. Usado pelo construtor
 * de campanhas para gerar produto/conjunto inline antes de submeter a campanha.
 *
 * Defaults para os campos não enviados:
 *   - price:        '0.00'
 *   - currency:     'BRL'
 *   - description:  ''
 *   - brand:        ''
 *   - availability: 'in stock'
 *   - condition:    'new'
 */
export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const {
    account_id, profile_name, catalog_id,
    ad_name, product_name,
    link, image_url,
    price, currency, description, brand, availability, condition,
  } = body ?? {};

  if (!account_id) return NextResponse.json({ error: 'account_id obrigatório' }, { status: 400 });
  if (!catalog_id) return NextResponse.json({ error: 'catalog_id obrigatório' }, { status: 400 });
  if (!ad_name || typeof ad_name !== 'string' || !ad_name.trim()) {
    return NextResponse.json({ error: 'ad_name obrigatório' }, { status: 400 });
  }
  if (!product_name || typeof product_name !== 'string' || !product_name.trim()) {
    return NextResponse.json({ error: 'product_name obrigatório' }, { status: 400 });
  }
  if (!link || typeof link !== 'string' || !link.trim()) {
    return NextResponse.json({ error: 'link obrigatório' }, { status: 400 });
  }
  if (!image_url || typeof image_url !== 'string' || !image_url.trim()) {
    return NextResponse.json({ error: 'image_url obrigatório' }, { status: 400 });
  }

  const auth = await resolveAuth(account_id, profile_name);
  if (!auth) return NextResponse.json({ error: 'Conta/perfil sem token válido.' }, { status: 404 });

  const preset: ProductPresetConfig = {
    description: typeof description === 'string' ? description : '',
    link: link.trim(),
    image_url: image_url.trim(),
    price: typeof price === 'string' && price.trim() ? price.trim() : '0.00',
    currency: typeof currency === 'string' && currency.trim() ? currency.trim() : 'BRL',
    brand: typeof brand === 'string' ? brand : '',
    availability: (availability as ProductPresetConfig['availability']) ?? 'in stock',
    condition: (condition as ProductPresetConfig['condition']) ?? 'new',
  };

  try {
    const result = await createProductWithSetUsingToken(
      {
        catalogId: catalog_id,
        bmId: '', // não usado por createProductWithSetUsingToken
        adName: ad_name.trim(),
        productName: product_name.trim(),
        preset,
      },
      auth.token,
    );
    return NextResponse.json({ success: true, ...result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
