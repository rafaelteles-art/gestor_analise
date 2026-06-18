/**
 * Sessões de criação de conjuntos (product sets) por catálogo.
 *
 * Um "lote" no modal "Criar produto + conjunto" do Catálogo vira uma sessão
 * persistida. Esta lib é a lógica PURA (sem I/O) que monta o rascunho da sessão
 * no cliente: atribui `orderIndex` pela linha do colar original, reencaixa os
 * sucessos (inclusive de retries) no slot original e produz a lista final
 * ordenada para persistir/copiar.
 *
 * Decisões de design: ver grill 2026-06-18.
 * - Retries fazem MERGE no mesmo registro, mantendo a ordem original.
 * - Reencaixe por `ad_name`; duplicado → primeiro slot vazio correspondente;
 *   nome inédito → anexado no fim com novo `orderIndex`.
 * - O upsert no servidor é da sessão inteira (idempotente, 1 write).
 */

/** Item criado com sucesso, na sua posição original. É o que vai pro JSONB. */
export interface ConjuntoSessionItem {
  orderIndex: number;
  product_set_id: string;
  retailer_id: string;
  product_id: string;
  product_name: string;
  ad_name: string;
}

/** Dados de um sucesso vindos da criação (sem orderIndex — a lib resolve o slot). */
export type ConjuntoSuccess = Omit<ConjuntoSessionItem, 'orderIndex'>;

/** Slot do rascunho: a posição original e o resultado (null = ainda não criado). */
export interface SessionDraftSlot {
  orderIndex: number;
  ad_name: string;
  result: Omit<ConjuntoSessionItem, 'orderIndex' | 'ad_name'> | null;
}

export interface SessionDraft {
  session_id: string;
  catalog_id: string;
  bm_id: string;
  slots: SessionDraftSlot[];
}

/** Cria o rascunho a partir do colar original (uma linha = um slot). */
export function initDraft(params: {
  session_id: string;
  catalog_id: string;
  bm_id: string;
  adNames: string[];
}): SessionDraft {
  return {
    session_id: params.session_id,
    catalog_id: params.catalog_id,
    bm_id: params.bm_id,
    slots: params.adNames.map((ad_name, orderIndex) => ({ orderIndex, ad_name, result: null })),
  };
}

/**
 * Registra um sucesso, reencaixando no primeiro slot vazio com o mesmo
 * `ad_name`. Se nenhum slot vazio corresponder, anexa no fim com novo índice.
 * Imutável: devolve um novo draft.
 */
export function recordSuccess(draft: SessionDraft, success: ConjuntoSuccess): SessionDraft {
  const { ad_name, product_set_id, retailer_id, product_id, product_name } = success;
  const result = { product_set_id, retailer_id, product_id, product_name };

  const targetIdx = draft.slots.findIndex((s) => s.result === null && s.ad_name === ad_name);

  if (targetIdx === -1) {
    const nextOrder = draft.slots.reduce((max, s) => Math.max(max, s.orderIndex), -1) + 1;
    return { ...draft, slots: [...draft.slots, { orderIndex: nextOrder, ad_name, result }] };
  }

  return {
    ...draft,
    slots: draft.slots.map((s, i) => (i === targetIdx ? { ...s, result } : s)),
  };
}

/** Itens criados com sucesso, ordenados pela posição original. */
export function sessionItems(draft: SessionDraft): ConjuntoSessionItem[] {
  return draft.slots
    .filter((s) => s.result !== null)
    .slice()
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((s) => ({ orderIndex: s.orderIndex, ad_name: s.ad_name, ...s.result! }));
}

/** Há ao menos um sucesso? (não persistir sessão de 0 sucessos.) */
export function hasResults(draft: SessionDraft): boolean {
  return draft.slots.some((s) => s.result !== null);
}

/** Texto pra copiar: um product_set_id por linha, na ordem original. */
export function copyIdsText(items: ConjuntoSessionItem[]): string {
  return items.map((i) => i.product_set_id).join('\n');
}

/** Texto pra colar em planilha: product_set_id<TAB>ad_name por linha. */
export function copyIdNameText(items: ConjuntoSessionItem[]): string {
  return items.map((i) => `${i.product_set_id}\t${i.ad_name}`).join('\n');
}
