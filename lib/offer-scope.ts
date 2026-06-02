/**
 * Resolve o parâmetro de URL `?oferta=` para um id de oferta ou null (= união
 * de tudo que está vinculado a alguma oferta). "todas"/vazio/ausente = null.
 */
export function parseOfertaParam(raw: string | string[] | null | undefined): number | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v == null || v === '' || v === 'todas') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}
