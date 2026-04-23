// Cache compartilhado entre ClientImport (preload) e CampaignHoverPopup (consumo).

export const globalHoverCache: Record<string, any> = {};

export function cacheKey(rtAd: string, accountId: string, rtCampaignId: string) {
  return `${rtAd}_${accountId}_${rtCampaignId}`;
}

// Requisições em andamento por (account, campaign) pra evitar chamadas duplicadas
// em re-renders, mas permitir preload paralelo para múltiplas contas selecionadas.
const inflightByKey: Map<string, Promise<void>> = new Map();

// Chunks pequenos evitam timeout do serverless (Firebase App Hosting / Cloud Run).
// Concorrência limitada pra não saturar pool do Postgres em produção.
const CHUNK_SIZE = 8;
const CONCURRENCY = 3;

async function fetchChunk(
  accountId: string,
  rtCampaignId: string,
  rtAds: string[],
): Promise<void> {
  try {
    const res = await fetch('/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metaAccountId: accountId, rtCampaignId, rtAds }),
    });
    if (!res.ok) {
      console.error('[preloadHistoryBatch] chunk falhou', res.status);
      return;
    }
    const d = await res.json();
    if (!d?.data) return;
    for (const rtAd of Object.keys(d.data)) {
      globalHoverCache[cacheKey(rtAd, accountId, rtCampaignId)] = d.data[rtAd];
    }
  } catch (e) {
    console.error('[preloadHistoryBatch] chunk error', e);
  }
}

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
      const chunks: string[][] = [];
      for (let i = 0; i < rtAds.length; i += CHUNK_SIZE) {
        chunks.push(rtAds.slice(i, i + CHUNK_SIZE));
      }

      let cursor = 0;
      const workers = Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, async () => {
        while (cursor < chunks.length) {
          const idx = cursor++;
          await fetchChunk(accountId, rtCampaignId, chunks[idx]);
        }
      });
      await Promise.all(workers);
    } finally {
      inflightByKey.delete(key);
    }
  })();

  inflightByKey.set(key, p);
  return p;
}
