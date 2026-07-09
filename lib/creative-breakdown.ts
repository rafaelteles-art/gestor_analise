// Agregações puras do Creative Breakdown (ver docs/adr/0011 e CONTEXT.md):
// fatia RT (sub3 × rt_ad) do cache diário + lado Meta level=ad ao vivo.

/** Linha plana do unnest dos blobs diários rt_sub3_ad:{rtCampaignId}. */
export interface Sub3AdRow {
  date: string;
  sub3: string;
  rt_ad: string;
  cost: number;
  total_revenue: number;
  convtype1: number;
  convtype2: number;
}

export interface CreativeMoney {
  creative: string;
  untracked: boolean;
  cost: number;
  revenue: number;
  sales: number;
  ic: number;
  profit: number;
  roas: number;
  cpa: number;
}

export interface MetaAdDelivery {
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpm: number;
}

export interface BreakdownRow extends CreativeMoney {
  ctr: number | null;
  cpm: number | null;
  impressions: number | null;
}

export interface WindowAgg {
  cost: number;
  revenue: number;
  profit: number;
  roas: number;
  sales: number;
  cpa: number;
}

type Totals = { cost: number; revenue: number; sales: number; ic: number };

function derive(t: Totals): Omit<CreativeMoney, 'creative' | 'untracked'> {
  return {
    cost: t.cost,
    revenue: t.revenue,
    sales: t.sales,
    ic: t.ic,
    profit: t.revenue - t.cost,
    roas: t.cost > 0 ? t.revenue / t.cost : 0,
    cpa: t.sales > 0 ? t.cost / t.sales : 0,
  };
}

/**
 * Linhas de dinheiro do dropdown para o período selecionado: filtra a fatia
 * (sub3 ∈ campaignIds, dateFrom ≤ date ≤ dateTo), agrupa por rt_ad e ordena por
 * custo desc. rt_ad vazio vira a linha "(não rastreado)" — mantida apenas quando
 * tem dinheiro/vendas (escondê-la quebraria a soma contra a linha da campanha) e
 * sempre por último.
 */
export function aggregateCreativeRows(
  rows: Sub3AdRow[],
  campaignIds: string[],
  dateFrom: string,
  dateTo: string,
): CreativeMoney[] {
  const ids = new Set(campaignIds);
  const byCreative = new Map<string, Totals>();

  for (const r of rows) {
    if (!ids.has(r.sub3)) continue;
    if (r.date < dateFrom || r.date > dateTo) continue;
    const cur = byCreative.get(r.rt_ad) ?? { cost: 0, revenue: 0, sales: 0, ic: 0 };
    cur.cost += r.cost;
    cur.revenue += r.total_revenue;
    cur.sales += r.convtype2;
    cur.ic += r.convtype1;
    byCreative.set(r.rt_ad, cur);
  }

  const out: CreativeMoney[] = [];
  for (const [creative, totals] of byCreative) {
    const untracked = creative === '';
    if (untracked && totals.cost <= 0 && totals.revenue <= 0 && totals.sales <= 0) continue;
    out.push({ creative, untracked, ...derive(totals) });
  }

  out.sort((a, b) => {
    if (a.untracked !== b.untracked) return a.untracked ? 1 : -1;
    return b.cost - a.cost;
  });
  return out;
}

/**
 * Janelas do hover por criativo: para cada range (date ≥ dateFrom, mesmo
 * contrato do /api/history), soma a fatia e deriva as métricas na forma que o
 * CampaignHoverPopup consome.
 */
export function aggregateCreativeWindows(
  rows: Sub3AdRow[],
  campaignIds: string[],
  ranges: { label: string; dateFrom: string }[],
): Record<string, Record<string, WindowAgg>> {
  const ids = new Set(campaignIds);
  const scoped = rows.filter((r) => ids.has(r.sub3));

  const out: Record<string, Record<string, WindowAgg>> = {};
  for (const { label, dateFrom } of ranges) {
    const byCreative = new Map<string, Totals>();
    for (const r of scoped) {
      if (r.date < dateFrom) continue;
      const cur = byCreative.get(r.rt_ad) ?? { cost: 0, revenue: 0, sales: 0, ic: 0 };
      cur.cost += r.cost;
      cur.revenue += r.total_revenue;
      cur.sales += r.convtype2;
      cur.ic += r.convtype1;
      byCreative.set(r.rt_ad, cur);
    }
    for (const [creative, t] of byCreative) {
      const d = derive(t);
      (out[creative] ??= {})[label] = {
        cost: d.cost,
        revenue: d.revenue,
        profit: d.profit,
        roas: d.roas,
        sales: d.sales,
        cpa: d.cpa,
      };
    }
  }
  return out;
}

/**
 * Soma as cópias de um criativo (level=ad da Meta agrupado por ad_name) e
 * deriva CTR/CPM ponderados. CPM sai convertido para BRL (spend da Graph é USD;
 * a tabela mostra BRL, como já faz o /api/import com mc.cpm * usdToBrl).
 */
export function aggregateMetaAdsByName(
  rows: { ad_name: string; spend: number; impressions: number; clicks: number }[],
  usdToBrl: number,
): Map<string, MetaAdDelivery> {
  const out = new Map<string, MetaAdDelivery>();
  for (const r of rows) {
    const name = (r.ad_name ?? '').trim();
    const cur = out.get(name) ?? { spend: 0, impressions: 0, clicks: 0, ctr: 0, cpm: 0 };
    cur.spend += r.spend;
    cur.impressions += r.impressions;
    cur.clicks += r.clicks;
    out.set(name, cur);
  }
  for (const agg of out.values()) {
    agg.ctr = agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0;
    agg.cpm = agg.impressions > 0 ? (agg.spend / agg.impressions) * 1000 * usdToBrl : 0;
  }
  return out;
}

/**
 * União RT ⨝ Meta por nome exato (ad_name === Creative Code, verificado ao
 * vivo): criativos do RT recebem o lado Meta quando existe; criativos que só a
 * Meta conhece entram com dinheiro zerado (gasto sem clique rastreado é alerta,
 * não ruído); a linha não-rastreada permanece por último.
 */
export function buildCreativeBreakdown(
  rtRows: CreativeMoney[],
  metaByName: Map<string, MetaAdDelivery>,
): BreakdownRow[] {
  const seen = new Set(rtRows.map((r) => r.creative));

  const joined: BreakdownRow[] = rtRows.map((r) => {
    const meta = metaByName.get(r.creative);
    return {
      ...r,
      ctr: meta ? meta.ctr : null,
      cpm: meta ? meta.cpm : null,
      impressions: meta ? meta.impressions : null,
    };
  });

  const metaOnly: BreakdownRow[] = [];
  for (const [name, meta] of metaByName) {
    if (name === '' || seen.has(name)) continue;
    metaOnly.push({
      creative: name,
      untracked: false,
      cost: 0,
      revenue: 0,
      sales: 0,
      ic: 0,
      profit: 0,
      roas: 0,
      cpa: 0,
      ctr: meta.ctr,
      cpm: meta.cpm,
      impressions: meta.impressions,
    });
  }
  metaOnly.sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0));

  const tracked = joined.filter((r) => !r.untracked);
  const untracked = joined.filter((r) => r.untracked);
  return [...tracked, ...metaOnly, ...untracked];
}
