/**
 * Match Meta campaign → rt_campaign do RedTrack, retornando receita,
 * conversões (convtype2) e custo (cost) agregados.
 *
 * Espelha a lógica de receita já usada em /api/import e /api/history:
 *   1. sub3 (Meta campaign_id) primeiro — soma TODOS os campaign_ids que
 *      tiverem entrada (cobre escalas ABO com várias campanhas homônimas,
 *      cada uma com seu próprio sub3, e evita contar o custo da campanha
 *      inteira mais de uma vez).
 *   2. Fallback por nome — match exato OU parcial (nome RT, com mais de 10
 *      chars, contido no nome Meta; cobre renomeações com prefixo).
 */
export interface RtAgg {
  total_revenue: number;
  convtype2: number;
  /** convtype1 = InitiateCheckout (IC). Opcional: rotas que não rastreiam IC
   *  (ex.: /api/history) podem omitir, e o match trata como 0. */
  ic?: number;
  cost: number;
}

export interface MetaCampaignKey {
  campaign_ids?: string[];
  campaign_id?: string;
  campaign_name: string;
}

export function matchRtCampaignCost(
  meta: MetaCampaignKey,
  bySub3: Map<string, RtAgg>,
  byName: Map<string, RtAgg>,
): RtAgg | null {
  const ids = meta.campaign_ids ?? (meta.campaign_id ? [meta.campaign_id] : []);

  let rev = 0, conv = 0, ic = 0, cost = 0, anyHit = false;
  for (const id of ids) {
    const hit = bySub3.get(id);
    if (hit) {
      anyHit = true;
      rev  += hit.total_revenue;
      conv += hit.convtype2;
      ic   += hit.ic ?? 0;
      cost += hit.cost;
    }
  }
  if (anyHit) return { total_revenue: rev, convtype2: conv, ic, cost };

  const metaLower = meta.campaign_name.toLowerCase();
  let nRev = 0, nConv = 0, nIc = 0, nCost = 0, found = false;
  for (const [rtName, agg] of byName) {
    const isExact   = rtName === meta.campaign_name;
    const isPartial = rtName.length > 10 && metaLower.includes(rtName.toLowerCase());
    if (isExact || isPartial) {
      found = true;
      nRev  += agg.total_revenue;
      nConv += agg.convtype2;
      nIc   += agg.ic ?? 0;
      nCost += agg.cost;
    }
  }
  return found ? { total_revenue: nRev, convtype2: nConv, ic: nIc, cost: nCost } : null;
}
