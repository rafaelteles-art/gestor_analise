// Trava de pixel — camada 1 (builder). Spec: docs/superpowers/specs/
// 2026-07-07-pixel-guard-design.md. Helpers puros para o ClientCampaignBuilder:
// o estado pixelId sobrevive à troca de conta, então o select pode renderizar
// vazio enquanto o submit publica um pixel de OUTRA conta (Meta subcode 1815045
// só no meio da fila, com campanha/conjunto já criados).

/**
 * Pixel órfão: a lista de pixels da conta terminou de carregar (sem erro) e o
 * pixelId selecionado não está nela → o builder deve resetar para '' (o
 * auto-select então escolhe o primeiro pixel da conta nova, ou o campo fica
 * vazio e a validação de presença bloqueia o submit).
 * Não decide nada durante loading nem sob erro de fetch: nesses estados a
 * lista pode estar vazia/stale por falha transitória, não por falta de acesso.
 */
export function shouldResetOrphanPixel(args: {
  pixelId: string;
  pixelIds: string[];
  loading: boolean;
  error: string | null;
}): boolean {
  const { pixelId, pixelIds, loading, error } = args;
  return pixelId !== '' && !loading && error === null && !pixelIds.includes(pixelId);
}

/**
 * Erros de submit relativos a pixel (substitui o check inline de presença que
 * vivia no builder): presença E pertencimento à conta. Engagement (PAGE_LIKES)
 * não usa pixel.
 *
 * Limitação conhecida: se o fetch de pixels da conta nova FALHA, a lista em
 * memória continua sendo a da conta anterior (useRefreshable preserva data em
 * erro) — o pertencimento é checado contra lista stale e pode passar. A camada
 * 2 (preflightPixelGuard no worker) cobre esse caso.
 */
export function pixelSubmitErrors(args: {
  isEngagement: boolean;
  pixelId: string;
  pixelIds: string[];
}): string[] {
  const { isEngagement, pixelId, pixelIds } = args;
  if (isEngagement) return [];
  if (!pixelId) return ['Selecione um pixel.'];
  if (!pixelIds.includes(pixelId)) return ['O pixel selecionado não pertence a esta conta.'];
  return [];
}
