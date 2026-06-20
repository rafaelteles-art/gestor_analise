// Cache compartilhado entre ClientImport (preload) e CampaignHoverPopup (consumo).

export const globalHoverCache: Record<string, any> = {};

// Chave de cache estável para um conjunto de campanhas RedTrack (oferta inteira).
// Ordena os ids para que a ordem de seleção não gere chaves diferentes.
export function rtCampaignSetKey(rtCampaignIds: string[]): string {
  return [...rtCampaignIds].sort().join(',');
}

export function cacheKey(rtAd: string, accountId: string, rtCampaignIds: string[]) {
  return `${rtAd}_${accountId}_${rtCampaignSetKey(rtCampaignIds)}`;
}

// Requisições em andamento por (account, set de campanhas) pra evitar chamadas
// duplicadas em re-renders, mas permitir preload paralelo para múltiplas contas.
const inflightByKey: Map<string, Promise<void>> = new Map();

export async function preloadHistoryBatch(
  accountId: string,
  rtCampaignIds: string[],
  rtAds: string[],
): Promise<void> {
  if (!accountId || rtCampaignIds.length === 0 || rtAds.length === 0) return;
  const setKey = rtCampaignSetKey(rtCampaignIds);
  const key = `${accountId}__${setKey}`;
  const existing = inflightByKey.get(key);
  if (existing) return existing;

  const p = (async () => {
    try {
      const res = await fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metaAccountId: accountId, rtCampaignIds, rtAds }),
      });
      if (!res.ok) {
        console.error('[preloadHistoryBatch] falhou', res.status);
        return;
      }
      const d = await res.json();
      if (!d?.data) return;
      for (const rtAd of Object.keys(d.data)) {
        globalHoverCache[cacheKey(rtAd, accountId, rtCampaignIds)] = d.data[rtAd];
      }
    } catch (e) {
      console.error('[preloadHistoryBatch]', e);
    } finally {
      inflightByKey.delete(key);
    }
  })();

  inflightByKey.set(key, p);
  return p;
}
