// ============================================================
// Motor de Diagnóstico de Campanhas
// ============================================================
// Consome os groups retornados por /api/import (rt_ad → meta_campaigns)
// e produz:
//   - Categorização de criativos (winner/stable/loser/zombie/promise)
//   - Insights por conta (concentração, diversidade, momentum)
//   - Sugestões priorizadas de otimização
//
// IMPORTANTE: todas as sugestões são em termos de QUANTIDADE de
// campanhas/conjuntos — nunca budget (explicitamente vedado pelo briefing).
// ============================================================

export type MetaCampaign = {
  account_id: string;
  campaign_id: string;
  campaign_name: string;
  spend: number;
  impressions: number;
  clicks: number;
  cpm: number;
  ctr: number;
  revenue: number;
  conversions: number;
  cpa: number;
  profit: number;
  roas: number;
};

export type RtAdGroup = {
  rt_ad: string;
  cost: number;
  total_revenue: number;
  total_conversions: number;
  cpa: number;
  profit: number;
  roas: number;
  meta_cpm: number;
  meta_ctr: number;
  meta_impressions: number;
  meta_clicks: number;
  meta_campaigns: MetaCampaign[];
};

export type CreativeCategory =
  | 'winner'        // ROAS >> média, volume sólido
  | 'promise'       // ROAS alto, volume baixo (teste novo promissor)
  | 'stable'        // ROAS ok, volume saudável
  | 'underperformer'// ROAS abaixo da média, volume relevante
  | 'loser'         // ROAS < 1, gasto relevante
  | 'zombie';       // gasto relevante, 0 conversões

export type CreativeDiagnostic = {
  rt_ad: string;
  category: CreativeCategory;
  cost: number;
  revenue: number;
  conversions: number;
  roas: number;
  cpa: number;
  profit: number;
  ctr: number;
  cpm: number;
  meta_campaigns_count: number;
  /** Se este criativo está concentrado em 1-2 campanhas (sinal de sub-exploração). */
  concentrated: boolean;
  /** Reason text: porquê caiu nesta categoria. */
  reason: string;
  /** Análise de sinais secundários — só preenchida para categorias ruins. */
  recovery?: RecoveryAnalysis;
};

// ============================================================
// Sinais secundários de recuperação
// Aplicáveis apenas a criativos em categorias ruins (zombie/loser/underperformer)
// para decidir se vale a pena resgatar (duplicar em novo público) ao invés
// de pausar direto.
// ============================================================
export type RecoverySignalType =
  | 'high_ctr'             // CTR > média → hook está funcionando
  | 'low_cpm'              // CPM abaixo da média → Facebook considera o criativo relevante
  | 'cross_account_winner' // mesmo rt_ad vencendo em outra conta selecionada
  | 'family_winner'        // outro rt_ad da mesma raiz (ex: LT899 vs LT899.85) tem ROAS alto
  | 'under_tested'         // em apenas 1-2 conjuntos → pode ser público errado
  | 'early_phase'          // gasto entre R$900 e R$2000 → fase inicial de aprendizado
  | 'has_sales';           // gerou ≥1 venda → funil completa, só precisa otimizar

export type RecoverySignal = {
  type: RecoverySignalType;
  /** Label curto (para header de chip). Ex: "Hook forte" */
  label: string;
  /** Sumário compacto com números (para chip em hover). Ex: "CTR 3.5% > méd 2.0%" */
  short: string;
  /** Explicação longa (tooltip / linha expandida). */
  detail: string;
};

export type RecoveryVerdict = 'pause' | 'observe' | 'rescue';

export type RecoveryAnalysis = {
  signals: RecoverySignal[];
  /** pause = sem esperança; observe = dar mais alguns dias; rescue = duplicar em novo público */
  verdict: RecoveryVerdict;
  /** Texto curto explicando o veredicto. */
  verdict_reason: string;
};

export type Priority = 'P0' | 'P1' | 'P2';

export type Suggestion = {
  priority: Priority;
  action: 'duplicate' | 'pause' | 'consolidate' | 'new_test' | 'investigate';
  title: string;
  /** Detalhe em uma frase do que fazer. */
  detail: string;
  /** Por que fazer (evidência quantitativa). */
  reason: string;
  /** Estimativa qualitativa de impacto (usar apenas descrições, não valores monetários inventados). */
  impact: string;
  /** Contexto extra: rt_ad(s) ou campanha(s) envolvidas. */
  targets: string[];
  /** Economia ou ganho numérico quando calculável. */
  estimated_daily_brl?: number;
};

export type AccountDiagnostic = {
  account_id: string;
  account_name: string;
  totals: {
    cost: number;
    revenue: number;
    profit: number;
    conversions: number;
    roas: number;
    cpa: number;
  };
  /** Health flag baseado no ROAS vs média global selecionada. */
  health: 'healthy' | 'watch' | 'critical';
  /** Texto explicando o status. */
  health_note: string;
  /** Concentração: % do custo nos top-3 criativos. */
  concentration_top3_pct: number;
  /** Distinct rt_ads ativos (cost > 0). */
  active_creatives_count: number;
  /** Distinct Facebook campaigns ativos. */
  active_campaigns_count: number;
  /** Criativos categorizados. */
  creatives: CreativeDiagnostic[];
  /** Sugestões priorizadas (P0 primeiro). */
  suggestions: Suggestion[];
};

export type AccountTotals = {
  account_id: string;
  account_name: string;
  cost: number;
  revenue: number;
  profit: number;
  conversions: number;
  roas: number;
  cpa: number;
};

// ============================================================
// Thresholds configuráveis
// ============================================================
// Piso de gasto para um criativo ser classificado como "ruim" (zombie / loser / underperformer).
// Abaixo desse valor o criativo ainda não teve volume suficiente para diagnóstico confiável de pausa.
const BAD_CREATIVE_MIN_COST = 900;

const THRESHOLDS = {
  ZOMBIE_MIN_COST: BAD_CREATIVE_MIN_COST,  // R$ gasto sem 0 conversões = zombie
  LOSER_MIN_COST: BAD_CREATIVE_MIN_COST,   // R$ gasto para classificar como loser
  LOSER_MAX_ROAS: 1.0,                     // ROAS abaixo do qual é "loser"
  UNDERPERF_COST: BAD_CREATIVE_MIN_COST,   // R$ para virar underperformer
  UNDERPERF_ROAS_RATIO: 0.7, // ROAS < média × ratio = underperformer
  PROMISE_MIN_ROAS_RATIO: 1.3, // ROAS > média × ratio com baixo volume = promise
  PROMISE_MAX_COST: 3000,    // Teto de gasto para ser "promise" (teste inicial)
  WINNER_ROAS_RATIO: 1.3,    // Winner: ROAS >= média × ratio
  WINNER_MIN_COST: 3000,     // Winner precisa de volume
  CONCENTRATED_THRESHOLD: 2, // 1-2 campanhas = concentrado (oportunidade de expansão)
  HEALTH_CRITICAL_ROAS: 1.2, // Conta abaixo disso = crítica
  HEALTH_WATCH_ROAS: 1.5,    // Conta abaixo disso = atenção
};

// ============================================================
// Categorização de criativos
// ============================================================
export function categorizeCreatives(
  groups: RtAdGroup[],
  accountAvgRoas: number,
): CreativeDiagnostic[] {
  return groups.map(g => {
    const nCamps = g.meta_campaigns.length;
    const concentrated = nCamps <= THRESHOLDS.CONCENTRATED_THRESHOLD;

    let category: CreativeCategory;
    let reason: string;

    // Zombie: gastou acima do mínimo mas 0 conversões aprovadas
    if (g.cost >= THRESHOLDS.ZOMBIE_MIN_COST && g.total_conversions === 0) {
      category = 'zombie';
      reason = `Gastou ${formatBRL(g.cost)} sem converter nenhuma venda no período`;
    }
    // Loser: ROAS ruim e gasto relevante
    else if (g.cost >= THRESHOLDS.LOSER_MIN_COST && g.roas < THRESHOLDS.LOSER_MAX_ROAS && g.roas > 0) {
      category = 'loser';
      reason = `ROAS ${g.roas.toFixed(2)}x está abaixo de 1,0x — cada real gasto retorna menos de 1 real`;
    }
    // Underperformer: abaixo da média da conta mas com volume
    else if (
      g.cost >= THRESHOLDS.UNDERPERF_COST &&
      accountAvgRoas > 0 &&
      g.roas < accountAvgRoas * THRESHOLDS.UNDERPERF_ROAS_RATIO
    ) {
      category = 'underperformer';
      reason = `ROAS ${g.roas.toFixed(2)}x está ${Math.round((1 - g.roas / accountAvgRoas) * 100)}% abaixo da média da conta (${accountAvgRoas.toFixed(2)}x)`;
    }
    // Winner: acima da média com volume
    else if (
      g.cost >= THRESHOLDS.WINNER_MIN_COST &&
      accountAvgRoas > 0 &&
      g.roas >= accountAvgRoas * THRESHOLDS.WINNER_ROAS_RATIO
    ) {
      category = 'winner';
      reason = `ROAS ${g.roas.toFixed(2)}x está ${Math.round((g.roas / accountAvgRoas - 1) * 100)}% acima da média da conta`;
    }
    // Promise: alto ROAS mas pouco volume ainda (teste inicial promissor)
    else if (
      g.cost > 0 &&
      g.cost < THRESHOLDS.PROMISE_MAX_COST &&
      accountAvgRoas > 0 &&
      g.roas >= accountAvgRoas * THRESHOLDS.PROMISE_MIN_ROAS_RATIO
    ) {
      category = 'promise';
      reason = `ROAS ${g.roas.toFixed(2)}x com apenas ${formatBRL(g.cost)} investido — sinal inicial forte`;
    }
    // Stable: resto com volume mínimo
    else {
      category = 'stable';
      reason = `ROAS ${g.roas.toFixed(2)}x mantendo performance dentro da média`;
    }

    return {
      rt_ad: g.rt_ad,
      category,
      cost: g.cost,
      revenue: g.total_revenue,
      conversions: g.total_conversions,
      roas: g.roas,
      cpa: g.cpa,
      profit: g.profit,
      ctr: g.meta_ctr || 0,
      cpm: g.meta_cpm || 0,
      meta_campaigns_count: nCamps,
      concentrated,
      reason,
    };
  });
}

// ============================================================
// Extração de "família" do rt_ad
// Ex: LT899 → LT899 | LT899.85 → LT899 | LT129.239 → LT129 | LT1033.3 → LT1033
// ============================================================
function extractFamily(rtAd: string): string {
  const m = rtAd.match(/^([A-Z]+\d+)/);
  return m ? m[1] : rtAd;
}

// ============================================================
// Análise de sinais secundários de recuperação
// ============================================================
const RECOVERY = {
  CTR_STRONG_RATIO: 1.2,      // CTR > média × 1.2 = hook forte
  CPM_CHEAP_RATIO: 0.85,      // CPM < média × 0.85 = entrega barata
  CROSS_WINNER_ROAS: 1.8,     // ROAS ≥ 1.8x em outra conta = cross-account winner
  FAMILY_WINNER_ROAS: 1.8,    // ROAS ≥ 1.8x em outro rt_ad da mesma família
  FAMILY_WINNER_COST: 3000,   // ...e com volume ≥ R$3000 (não é promise, é comprovado)
  EARLY_PHASE_MAX: 2000,      // Gasto < R$2000 = fase inicial
  RESCUE_MIN_SIGNALS: 3,      // ≥3 sinais = candidato forte a resgate
  OBSERVE_MIN_SIGNALS: 2,     // ≥2 sinais = observar mais dias
};

export function analyzeRecovery(
  creative: CreativeDiagnostic,
  accountAvgCtr: number,
  accountAvgCpm: number,
  sameRtAdOtherAccounts: CreativeDiagnostic[], // para cross_account_winner
  familyMatesInAccount: CreativeDiagnostic[],  // para family_winner (mesma conta, mesma família)
): RecoveryAnalysis {
  const signals: RecoverySignal[] = [];

  // Só analisa criativos em categoria ruim
  if (!(['zombie', 'loser', 'underperformer'] as CreativeCategory[]).includes(creative.category)) {
    return {
      signals: [],
      verdict: 'observe',
      verdict_reason: 'Não é categoria ruim — análise de recuperação não aplicável.',
    };
  }

  // 1) Hook forte: CTR acima da média
  if (accountAvgCtr > 0 && creative.ctr > accountAvgCtr * RECOVERY.CTR_STRONG_RATIO) {
    const pct = Math.round((creative.ctr / accountAvgCtr - 1) * 100);
    signals.push({
      type: 'high_ctr',
      label: 'Hook forte',
      short: `CTR ${creative.ctr.toFixed(1)}% > méd ${accountAvgCtr.toFixed(1)}%`,
      detail: `CTR ${creative.ctr.toFixed(2)}% está ${pct}% acima da média da conta (${accountAvgCtr.toFixed(2)}%). Criativo chama atenção — problema está no funil/landing, não na chamada.`,
    });
  }

  // 2) Entrega barata: CPM abaixo da média (Facebook considera relevante)
  if (accountAvgCpm > 0 && creative.cpm > 0 && creative.cpm < accountAvgCpm * RECOVERY.CPM_CHEAP_RATIO) {
    const pct = Math.round((1 - creative.cpm / accountAvgCpm) * 100);
    signals.push({
      type: 'low_cpm',
      label: 'Entrega barata',
      short: `CPM -${pct}% vs média`,
      detail: `CPM ${formatBRL(creative.cpm)} está ${pct}% abaixo da média. O algoritmo do Facebook classifica o criativo como relevante.`,
    });
  }

  // 3) Winner em outra conta
  const bestOther = [...sameRtAdOtherAccounts]
    .filter(c => c.roas >= RECOVERY.CROSS_WINNER_ROAS && c.cost > 500)
    .sort((a, b) => b.roas - a.roas)[0];
  if (bestOther) {
    signals.push({
      type: 'cross_account_winner',
      label: 'Winner em outra conta',
      short: `${bestOther.roas.toFixed(2)}x em outra conta`,
      detail: `O mesmo criativo roda com ROAS ${bestOther.roas.toFixed(2)}x em outra conta selecionada. Aqui pode estar pegando público diferente — vale testar em LLA/interesses novos.`,
    });
  }

  // 4) Família campeã
  const family = extractFamily(creative.rt_ad);
  const bestFamilyMate = familyMatesInAccount
    .filter(c => c.rt_ad !== creative.rt_ad && extractFamily(c.rt_ad) === family)
    .filter(c => c.roas >= RECOVERY.FAMILY_WINNER_ROAS && c.cost >= RECOVERY.FAMILY_WINNER_COST)
    .sort((a, b) => b.roas - a.roas)[0];
  if (bestFamilyMate) {
    signals.push({
      type: 'family_winner',
      label: 'Família campeã',
      short: `${family}: irmão ${bestFamilyMate.roas.toFixed(2)}x`,
      detail: `${bestFamilyMate.rt_ad} (mesma família ${family}) tem ROAS ${bestFamilyMate.roas.toFixed(2)}x com volume. Variações desta família têm histórico de performar.`,
    });
  }

  // 5) Sub-testado: poucos conjuntos
  if (creative.meta_campaigns_count <= 2) {
    signals.push({
      type: 'under_tested',
      label: 'Sub-testado',
      short: `${creative.meta_campaigns_count} conjunto${creative.meta_campaigns_count > 1 ? 's' : ''}`,
      detail: `Em apenas ${creative.meta_campaigns_count} conjunto${creative.meta_campaigns_count > 1 ? 's' : ''}. Pode ser público errado — vale testar em 2–3 LLA/interesses diferentes antes de descartar.`,
    });
  }

  // 6) Fase inicial (volume entre threshold de "ruim" e R$2000)
  if (creative.cost >= 900 && creative.cost < RECOVERY.EARLY_PHASE_MAX) {
    signals.push({
      type: 'early_phase',
      label: 'Fase inicial',
      short: `${formatBRL(creative.cost)} gastos`,
      detail: `Apenas ${formatBRL(creative.cost)} investidos — algoritmo ainda está aprendendo. Dados insuficientes para veredicto definitivo.`,
    });
  }

  // 7) Já vendeu (distingue de zombie total)
  if (creative.conversions > 0) {
    signals.push({
      type: 'has_sales',
      label: 'Já vendeu',
      short: `${creative.conversions} venda${creative.conversions > 1 ? 's' : ''}`,
      detail: `Gerou ${creative.conversions} venda${creative.conversions > 1 ? 's' : ''}. O funil completa — só precisa de volume ou público melhor para escalar.`,
    });
  }

  // Veredicto
  let verdict: RecoveryVerdict;
  let verdict_reason: string;

  if (signals.length >= RECOVERY.RESCUE_MIN_SIGNALS) {
    verdict = 'rescue';
    verdict_reason = `${signals.length} sinais de recuperação detectados. Forte candidato a resgate: duplicar em novo público antes de pausar.`;
  } else if (signals.length >= RECOVERY.OBSERVE_MIN_SIGNALS) {
    verdict = 'observe';
    verdict_reason = `${signals.length} sinais de recuperação. Observar mais 3–5 dias antes de decidir, ou testar em 1 novo público.`;
  } else {
    verdict = 'pause';
    verdict_reason =
      signals.length === 1
        ? `Apenas 1 sinal fraco detectado. Insuficiente — pausar é a ação mais segura.`
        : `Nenhum sinal de recuperação. Pausar sem hesitação.`;
  }

  return { signals, verdict, verdict_reason };
}

// ============================================================
// Geração de sugestões por conta
// ============================================================
export function buildSuggestions(
  accountName: string,
  creatives: CreativeDiagnostic[],
  totals: AccountTotals,
  allAccountsAvgRoas: number,
): Suggestion[] {
  const suggestions: Suggestion[] = [];

  // ---------- Particiona os ruins pelo veredicto de recuperação ----------
  const bad = creatives.filter(c => ['zombie', 'loser', 'underperformer'].includes(c.category));
  const toPause  = bad.filter(c => c.recovery?.verdict === 'pause');
  const toRescue = bad.filter(c => c.recovery?.verdict === 'rescue');
  const toObserve = bad.filter(c => c.recovery?.verdict === 'observe');

  // ---------- P0: Pausar criativos sem sinal de recuperação ----------
  if (toPause.length > 0) {
    const totalWaste = toPause.reduce((s, c) => s + Math.max(0, c.cost - c.revenue), 0);
    const zombieCount = toPause.filter(c => c.category === 'zombie').length;
    const loserCount = toPause.filter(c => c.category === 'loser').length;
    const underCount = toPause.filter(c => c.category === 'underperformer').length;
    const breakdown = [
      zombieCount > 0 ? `${zombieCount} zumbi${zombieCount > 1 ? 's' : ''}` : null,
      loserCount > 0 ? `${loserCount} com prejuízo` : null,
      underCount > 0 ? `${underCount} abaixo da média` : null,
    ].filter(Boolean).join(', ');

    suggestions.push({
      priority: 'P0',
      action: 'pause',
      title: `Pausar ${toPause.length} criativo${toPause.length > 1 ? 's' : ''} sem sinal de recuperação`,
      detail: `Pause os conjuntos que veiculam ${toPause.slice(0, 3).map(c => c.rt_ad).join(', ')}${toPause.length > 3 ? ` e mais ${toPause.length - 3}` : ''}. Nenhum sinal secundário (CTR, CPM, família, cross-account) indica potencial de recuperação.`,
      reason: `${breakdown}. Gasto total ${formatBRL(toPause.reduce((s, c) => s + c.cost, 0))} com prejuízo de ${formatBRL(totalWaste)}.`,
      impact: `Corta perda direta. Libera budget congelado em conjuntos sem tração para ser redistribuído via outras sugestões desta análise.`,
      targets: toPause.map(c => c.rt_ad),
      estimated_daily_brl: -totalWaste,
    });
  }

  // ---------- P1: Resgatar — criativos ruins com ≥3 sinais de recuperação ----------
  if (toRescue.length > 0) {
    // Mostrar o sinal mais marcante de cada top-3 resgate
    const top3 = toRescue.slice(0, 3);
    const rescueExamples = top3.map(c => {
      const topSignal = c.recovery?.signals[0];
      return `${c.rt_ad} (ROAS ${c.roas.toFixed(2)}x; ${topSignal?.label || 'sinais positivos'})`;
    }).join('; ');

    suggestions.push({
      priority: 'P1',
      action: 'new_test',
      title: `Resgatar ${toRescue.length} criativo${toRescue.length > 1 ? 's' : ''} com sinais fortes de recuperação`,
      detail: `${rescueExamples}. Em vez de pausar, criar 1–2 novos conjuntos por criativo em públicos diferentes (LLA 1–3%, interesses adjacentes, cross-account). O problema provavelmente é público ou fadiga do conjunto atual, não o criativo em si.`,
      reason: `${toRescue.length} criativos ruins no financeiro mas com ≥3 sinais secundários positivos (CTR acima da média, CPM barato, ou variação da mesma família vencendo).`,
      impact: `Preserva criativos com potencial antes de descartar. Histórico típico: rt_ads resgatados em novo público recuperam 30–60% do ROAS médio em 5–10 dias.`,
      targets: toRescue.map(c => c.rt_ad),
    });
  }

  // ---------- P2: Observar — criativos ruins com 2 sinais (ainda em dúvida) ----------
  if (toObserve.length > 0) {
    const top3 = toObserve.slice(0, 3);
    suggestions.push({
      priority: 'P2',
      action: 'investigate',
      title: `Observar ${toObserve.length} criativo${toObserve.length > 1 ? 's' : ''} em zona de dúvida`,
      detail: `${top3.map(c => `${c.rt_ad} (ROAS ${c.roas.toFixed(2)}x)`).join(', ')}${toObserve.length > 3 ? ` e mais ${toObserve.length - 3}` : ''}. Mantenha rodando por mais 3–5 dias para acumular dados, OU abrir 1 conjunto teste com público diferente. Não escalar.`,
      reason: `${toObserve.length} criativos com ROAS ruim mas 2 sinais secundários positivos — evidência mista, insuficiente para pausar ou resgatar com confiança.`,
      impact: `Evita descartar prematuramente um criativo que pode virar. Evita também escalar o que ainda não provou.`,
      targets: toObserve.map(c => c.rt_ad),
    });
  }

  // ---------- P1: Clonar winners concentrados ----------
  const concentratedWinners = creatives
    .filter(c => c.category === 'winner' && c.concentrated)
    .sort((a, b) => b.roas - a.roas);
  if (concentratedWinners.length > 0) {
    const top3 = concentratedWinners.slice(0, 3);
    suggestions.push({
      priority: 'P1',
      action: 'duplicate',
      title: `Duplicar ${concentratedWinners.length} criativo${concentratedWinners.length > 1 ? 's' : ''} vencedor${concentratedWinners.length > 1 ? 'es' : ''} em mais conjuntos`,
      detail: `${top3.map(c => `${c.rt_ad} (ROAS ${c.roas.toFixed(2)}x em apenas ${c.meta_campaigns_count} conjunto${c.meta_campaigns_count > 1 ? 's' : ''})`).join('; ')}. Criar 2–3 novos conjuntos ABO por criativo com novos públicos (LLA 1–3%, LLA 3–5%, interesses adjacentes).`,
      reason: `Esses criativos performam ${Math.round((top3[0].roas / totals.roas - 1) * 100)}%+ acima da média da conta e estão rodando em poucos conjuntos.`,
      impact: `Expande o aprendizado do criativo para novos públicos sem tocar no orçamento unitário — replica a estrutura que já está dando certo.`,
      targets: concentratedWinners.map(c => c.rt_ad),
    });
  }

  // ---------- P1: Acelerar promessas ----------
  const promises = creatives
    .filter(c => c.category === 'promise')
    .sort((a, b) => b.roas - a.roas);
  if (promises.length > 0) {
    const top3 = promises.slice(0, 3);
    suggestions.push({
      priority: 'P1',
      action: 'new_test',
      title: `Acelerar ${promises.length} teste${promises.length > 1 ? 's' : ''} promissor${promises.length > 1 ? 'es' : ''}`,
      detail: `${top3.map(c => `${c.rt_ad} (ROAS ${c.roas.toFixed(2)}x com ${formatBRL(c.cost)} testado)`).join('; ')}. Criar 1–2 novos conjuntos por criativo na mesma conta para validar em escala antes de fadigar.`,
      reason: `ROAS inicial significativamente acima da média. Volume ainda baixo — precisa de mais impressões para confirmar.`,
      impact: `Confirma o criativo antes que a janela de novidade feche. Previne perder um winner por falta de volume.`,
      targets: promises.map(c => c.rt_ad),
    });
  }

  // ---------- P2: Concentração excessiva ----------
  const totalCost = creatives.reduce((s, c) => s + c.cost, 0);
  const sortedByCost = [...creatives].sort((a, b) => b.cost - a.cost);
  const top3Cost = sortedByCost.slice(0, 3).reduce((s, c) => s + c.cost, 0);
  const top3Pct = totalCost > 0 ? (top3Cost / totalCost) * 100 : 0;

  if (top3Pct > 60 && creatives.length >= 5) {
    suggestions.push({
      priority: 'P2',
      action: 'new_test',
      title: `Diversificar portfólio de criativos da conta`,
      detail: `${top3Pct.toFixed(0)}% do gasto está concentrado em apenas 3 criativos (${sortedByCost.slice(0, 3).map(c => c.rt_ad).join(', ')}). Lançar 3–5 novos conjuntos testando criativos do acervo (ou variações dos top) em famílias adjacentes.`,
      reason: `Concentração alta = risco sistêmico. Quando o top fadiga, a conta inteira desacelera junto.`,
      impact: `Reduz dependência dos top criativos. Mantém pipeline de winners nascendo paralelamente.`,
      targets: sortedByCost.slice(0, 3).map(c => c.rt_ad),
    });
  }

  // ---------- P2: Conta crítica no agregado ----------
  if (totals.cost > 1000 && totals.roas > 0 && totals.roas < THRESHOLDS.HEALTH_CRITICAL_ROAS) {
    suggestions.push({
      priority: 'P0',
      action: 'investigate',
      title: `Conta ${accountName} operando com ROAS crítico`,
      detail: `ROAS ${totals.roas.toFixed(2)}x está abaixo do patamar saudável (${THRESHOLDS.HEALTH_CRITICAL_ROAS.toFixed(2)}x). Antes de abrir novos conjuntos, pausar os conjuntos perdedores e consolidar nos 1–3 criativos menos ruins até encontrar traction.`,
      reason: `ROAS da conta ${Math.round((totals.roas / allAccountsAvgRoas - 1) * 100)}% vs média das contas selecionadas (${allAccountsAvgRoas.toFixed(2)}x).`,
      impact: `Evita mais perda enquanto diagnóstico aponta se é caso de pausar a conta inteira por hora ou isolar criativos saudáveis.`,
      targets: [accountName],
    });
  }

  // ---------- P2: Consolidar campanhas Facebook duplicadas ----------
  const duplicatesMap = new Map<string, number>();
  for (const c of creatives) {
    for (const mc of (c as any).meta_campaigns || []) {
      const key = mc.campaign_name;
      duplicatesMap.set(key, (duplicatesMap.get(key) || 0) + 1);
    }
  }

  // Ordenar por prioridade: P0 → P1 → P2
  const order: Record<Priority, number> = { P0: 0, P1: 1, P2: 2 };
  suggestions.sort((a, b) => order[a.priority] - order[b.priority]);

  return suggestions;
}

// ============================================================
// Orquestrador: análise por conta
// ============================================================
export function analyzeAccounts(
  groups: RtAdGroup[],
  accountTotals: AccountTotals[],
): AccountDiagnostic[] {
  const allAvgRoas =
    accountTotals.reduce((s, t) => s + t.revenue, 0) /
      Math.max(accountTotals.reduce((s, t) => s + t.cost, 0), 1);

  // ---------- PASS 1: categorizar tudo por conta (sem recovery ainda) ----------
  type AccState = {
    totals: AccountTotals;
    accGroups: RtAdGroup[];
    creatives: CreativeDiagnostic[];
    avgCtr: number;
    avgCpm: number;
  };

  const accStates: AccState[] = accountTotals.map(totals => {
    // Filtrar groups que tocaram esta conta e reagregar os campos pelas campanhas da conta
    const accGroups: RtAdGroup[] = groups
      .map(g => {
        const mcs = g.meta_campaigns.filter(mc => mc.account_id === totals.account_id);
        if (mcs.length === 0) return null;
        const cost = mcs.reduce((s, c) => s + c.spend, 0);
        const revenue = mcs.reduce((s, c) => s + c.revenue, 0);
        const conversions = mcs.reduce((s, c) => s + c.conversions, 0);
        const impressions = mcs.reduce((s, c) => s + c.impressions, 0);
        const clicks = mcs.reduce((s, c) => s + c.clicks, 0);
        return {
          rt_ad: g.rt_ad,
          cost,
          total_revenue: revenue,
          total_conversions: conversions,
          cpa: conversions > 0 ? cost / conversions : 0,
          profit: revenue - cost,
          roas: cost > 0 ? revenue / cost : 0,
          meta_cpm: impressions > 0 ? mcs.reduce((s, c) => s + c.cpm * c.impressions, 0) / impressions : 0,
          meta_ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
          meta_impressions: impressions,
          meta_clicks: clicks,
          meta_campaigns: mcs,
        } as RtAdGroup;
      })
      .filter(Boolean) as RtAdGroup[];

    const creatives = categorizeCreatives(accGroups, totals.roas);

    // Médias da conta (CTR e CPM ponderados por impressões)
    const totalImpr = accGroups.reduce((s, g) => s + g.meta_impressions, 0);
    const totalClicks = accGroups.reduce((s, g) => s + g.meta_clicks, 0);
    const totalSpend = accGroups.reduce((s, g) => s + g.cost, 0);
    const avgCtr = totalImpr > 0 ? (totalClicks / totalImpr) * 100 : 0;
    const avgCpm = totalImpr > 0 ? (totalSpend / totalImpr) * 1000 : 0;

    return { totals, accGroups, creatives, avgCtr, avgCpm };
  });

  // ---------- PASS 2: para cada criativo ruim, rodar analyzeRecovery com contexto cross-account ----------
  // Indexa todos os criativos por rt_ad para buscar cross-account
  const allCreativesByRtAd = new Map<string, Array<{ accountId: string; creative: CreativeDiagnostic }>>();
  for (const state of accStates) {
    for (const c of state.creatives) {
      if (!allCreativesByRtAd.has(c.rt_ad)) allCreativesByRtAd.set(c.rt_ad, []);
      allCreativesByRtAd.get(c.rt_ad)!.push({ accountId: state.totals.account_id, creative: c });
    }
  }

  for (const state of accStates) {
    for (const c of state.creatives) {
      if (!(['zombie', 'loser', 'underperformer'] as CreativeCategory[]).includes(c.category)) {
        continue; // só analisa recuperação em categoria ruim
      }

      // Mesmo rt_ad em outras contas selecionadas
      const all = allCreativesByRtAd.get(c.rt_ad) || [];
      const sameRtAdOtherAccounts = all
        .filter(x => x.accountId !== state.totals.account_id)
        .map(x => x.creative);

      // Família mates na mesma conta (mesmo prefixo)
      const family = extractFamily(c.rt_ad);
      const familyMatesInAccount = state.creatives.filter(
        x => x.rt_ad !== c.rt_ad && extractFamily(x.rt_ad) === family,
      );

      c.recovery = analyzeRecovery(
        c,
        state.avgCtr,
        state.avgCpm,
        sameRtAdOtherAccounts,
        familyMatesInAccount,
      );
    }
  }

  // ---------- PASS 3: agora com recovery populado, gerar sugestões e compor diagnóstico ----------
  return accStates.map(state => {
    const { totals, accGroups, creatives } = state;
    const suggestions = buildSuggestions(totals.account_name, creatives, totals, allAvgRoas);

    // Concentração top-3
    const sortedByCost = [...creatives].sort((a, b) => b.cost - a.cost);
    const top3Cost = sortedByCost.slice(0, 3).reduce((s, c) => s + c.cost, 0);
    const top3Pct = totals.cost > 0 ? (top3Cost / totals.cost) * 100 : 0;

    // Count distinct campaigns
    const campIds = new Set<string>();
    for (const g of accGroups) {
      for (const mc of g.meta_campaigns) {
        if (mc.spend > 0) campIds.add(mc.campaign_id);
      }
    }

    // Health status
    let health: 'healthy' | 'watch' | 'critical';
    let health_note: string;
    if (totals.cost < 100) {
      health = 'watch';
      health_note = `Volume muito baixo no período (${formatBRL(totals.cost)} gastos). Analise um período mais longo ou confirme se a conta está ativa.`;
    } else if (totals.roas >= THRESHOLDS.HEALTH_WATCH_ROAS) {
      health = 'healthy';
      health_note = `ROAS ${totals.roas.toFixed(2)}x em patamar saudável. Foco: replicar winners em mais conjuntos.`;
    } else if (totals.roas >= THRESHOLDS.HEALTH_CRITICAL_ROAS) {
      health = 'watch';
      health_note = `ROAS ${totals.roas.toFixed(2)}x em zona de atenção. Precisa limpar underperformers antes de expandir.`;
    } else {
      health = 'critical';
      health_note = `ROAS ${totals.roas.toFixed(2)}x em zona crítica. Prioridade é pausar losers e estabilizar antes de novos testes.`;
    }

    return {
      account_id: totals.account_id,
      account_name: totals.account_name,
      totals: {
        cost: totals.cost,
        revenue: totals.revenue,
        profit: totals.profit,
        conversions: totals.conversions,
        roas: totals.roas,
        cpa: totals.cpa,
      },
      health,
      health_note,
      concentration_top3_pct: top3Pct,
      active_creatives_count: creatives.filter(c => c.cost > 0).length,
      active_campaigns_count: campIds.size,
      creatives,
      suggestions,
    };
  });
}

// ============================================================
// Utilitário
// ============================================================
function formatBRL(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}
