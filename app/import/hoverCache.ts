// Cache compartilhado entre ClientImport (preload) e CampaignHoverPopup (consumo).

export const globalHoverCache: Record<string, any> = {};

export function cacheKey(rtAd: string, accountId: string, rtCampaignId: string) {
  return `${rtAd}_${accountId}_${rtCampaignId}`;
}

// Requisições em andamento por (account, campaign) pra evitar chamadas duplicadas
// em re-renders, mas permitir preload paralelo para múltiplas contas selecionadas.
const inflightByKey: Map<string, Promise<void>> = new Map();

export async function preloadHistoryBatch(
  accountId: string,
  rtCampaignId: string,
  rtAds: string[],
): Promise<void> {
  if (!accountId || !rtCampaignId || rtAds.length === 0) return;
  const key = `${accountId}__${rtCampaignId}`;
  const existing = inflightByKey.get(key);
  if (existing) return existing;

  const p = (async () => {
    try {
      const res = await fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metaAccountId: accountId, rtCampaignId, rtAds }),
      });
      const d = await res.json();
      if (!d?.data) return;
      for (const rtAd of Object.keys(d.data)) {
        globalHoverCache[cacheKey(rtAd, accountId, rtCampaignId)] = d.data[rtAd];
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
