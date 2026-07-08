/**
 * Helpers puros (sem I/O) para criar itens em catálogos onde a Meta bloqueia a
 * edge legada `POST /{catalog_id}/products` (create) e exige o `items_batch`.
 *
 * Contexto: uma vez que um catálogo contém itens que só podem ser escritos via
 * items_batch, a edge /products devolve:
 *
 *   (#100) This catalog contains other items. Use the items_batch endpoint with
 *   item_type=OTHER to create items in this catalog.
 *
 * Isso acontece mesmo com `vertical=commerce` — então NÃO dá pra detectar pelo
 * vertical; a única detecção confiável é pelo próprio erro (`isItemsBatchRequiredError`).
 *
 * ⚠️ ARMADILHA (verificado ao vivo 2026-07-07, catálogo 2542505109593666, via
 * validate_only nas versões v21/v23/v25): a mensagem manda usar
 * `item_type=OTHER`, MAS `OTHER` é rejeitado ("This value of item_type is not
 * currently supported."). O valor que a Meta realmente aceita é
 * **`PRODUCT_ITEM`** (o mesmo que o app já usa em updateProductVideo). Por isso
 * o create manda `item_type=PRODUCT_ITEM`, não OTHER. NÃO troque por OTHER
 * confiando no texto do erro.
 *
 * Nomes de campo: o feed do items_batch usa os nomes do CATÁLOGO/FEED, que
 * diferem da edge /products:
 *   /products   → name,  url,  image_url, price (centavos int) + currency (sep)
 *   items_batch → title, link, image_link, price (string "97.00 BRL")
 * O `id` dentro de `data` é o retailer_id (content id) do item.
 *
 * Mantido puro de propósito: testável em vitest (a convenção do projeto é que
 * código Graph/DB é verificado por script, não por unit test) e importável por
 * scripts Node.
 */

/** item_type que a Meta aceita no items_batch deste caso (NÃO é OTHER — ver doc acima). */
export const ITEMS_BATCH_ITEM_TYPE = 'PRODUCT_ITEM';

/** Campos aceitos pelo `data` de um request items_batch (CREATE). */
export interface ItemsBatchCreateInput {
  /** retailer_id do produto — vira `id` no payload. */
  retailerId: string;
  /** Título do produto (campo `title`). */
  title: string;
  /** Preço já formatado como string, ex: "97.00 BRL". */
  price: string;
  link: string;
  imageLink: string;
  description?: string;
  brand?: string;
  availability?: string;
  condition?: string;
}

/**
 * Detecta o erro específico que exige o items_batch ("contains other items /
 * use the items_batch endpoint").
 *
 * Robusto a diferentes formatos: aceita a MetaCatalogApiError deste projeto
 * (com `.code`/`.message`/`.raw`) ou um objeto de erro cru da Graph API.
 * Casa em code 100 + qualquer menção a items_batch / item_type=OTHER /
 * "other items" no texto (message, error_user_msg, error_user_title).
 */
export function isItemsBatchRequiredError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, any>;
  const raw = (e.raw && typeof e.raw === 'object' ? e.raw : e) as Record<string, any>;

  const code = e.code ?? raw.code;
  const codeIs100 = code === 100 || code === '100';
  if (!codeIs100) return false;

  const text = [e.message, raw.message, raw.error_user_msg, raw.error_user_title]
    .filter((s) => typeof s === 'string')
    .join(' ');
  return /items_batch|item_type\s*=?\s*other|contains other items|other items/i.test(text);
}

/**
 * Formata preço para o feed do items_batch: "<valor 2 casas> <MOEDA ISO>".
 * Ex: (97, "brl") → "97.00 BRL". Retorna string vazia se valor inválido.
 */
export function formatItemsBatchPrice(amount: number, currency: string): string {
  if (!isFinite(amount) || amount < 0) return '';
  const cur = String(currency || '').trim().toUpperCase();
  return `${amount.toFixed(2)}${cur ? ` ${cur}` : ''}`;
}

/**
 * Monta o objeto `data` de um request items_batch CREATE.
 * Campos opcionais vazios são omitidos (a Meta pode rejeitar strings vazias).
 * Sempre inclui os obrigatórios: id, title, price, link, image_link.
 */
export function buildItemsBatchCreateData(input: ItemsBatchCreateInput): Record<string, string> {
  const data: Record<string, string> = {
    id: input.retailerId,
    title: input.title,
    price: input.price,
    link: input.link,
    image_link: input.imageLink,
  };
  const opt: Array<[keyof ItemsBatchCreateInput, string]> = [
    ['description', 'description'],
    ['brand', 'brand'],
    ['availability', 'availability'],
    ['condition', 'condition'],
  ];
  for (const [key, field] of opt) {
    const v = input[key];
    if (typeof v === 'string' && v.trim() !== '') data[field] = v;
  }
  return data;
}
