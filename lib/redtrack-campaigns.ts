import { pool } from './db';
import { getRedtrackApiKey } from './config';

export type RtCampaignRow = {
  campaign_id: string;
  campaign_name: string;
  status: string;
  is_selected: boolean;
};

// Timeout do fetch: sem ele, um hang no RedTrack segura a request até a parede
// de 300s do load balancer e o cliente recebe o stream cortado sem done/error.
const REDTRACK_FETCH_TIMEOUT_MS = 60_000;

// Quantas linhas por INSERT em lote (2303 campanhas ≈ 9.2k params; teto do pg é 65k).
const UPSERT_CHUNK_SIZE = 5000;

// Mapeia o payload cru do RedTrack e deduplica por campaign_id (última ocorrência
// vence) — o upsert em lote rejeita a mesma chave duas vezes no mesmo INSERT.
export function mapRedTrackCampaigns(raw: any[]): RtCampaignRow[] {
  const byId = new Map<string, RtCampaignRow>();
  for (const c of raw) {
    const id = String(c.id);
    byId.set(id, {
      campaign_id: id,
      campaign_name: c.title || `Campaign ${id}`,
      status: c.status || 'unknown',
      is_selected: false,
    });
  }
  return Array.from(byId.values());
}

export async function fetchAndSyncRedTrackCampaigns(onProgress?: (message: string) => void) {
  const report = (msg: string) => { try { onProgress?.(msg); } catch {} };
  // Lê do banco (app_settings) com fallback para process.env — ver lib/config.ts
  const apiKey = await getRedtrackApiKey();
  if (!apiKey) {
    console.log("Ignorando RedTrack scanner: API Key ausente.");
    report("RedTrack API Key ausente — pulando");
    return { success: true, count: 0, campaigns: [] };
  }

  try {
    console.log("Buscando campanhas do RedTrack...");
    report("Buscando campanhas do RedTrack…");
    // O RedTrack ignora limit e devolve TODAS as campanhas (~2300) numa resposta só.
    const url = `https://api.redtrack.io/campaigns?api_key=${apiKey}&limit=500`;

    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json"
      },
      signal: AbortSignal.timeout(REDTRACK_FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
        // statusText vem vazio em HTTP/2 — inclui o código numérico sempre.
        throw new Error(`RedTrack API error: HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`);
    }

    const data = await res.json();
    const campaigns = Array.isArray(data) ? data : (data.data || []);
    const mappedCampaigns = mapRedTrackCampaigns(campaigns);

    console.log(`Salvando ${mappedCampaigns.length} campanhas RedTrack no banco...`);
    report(`Salvando ${mappedCampaigns.length} campanhas RedTrack no banco…`);

    if (mappedCampaigns.length > 0) {
      // Upsert em lote: 1 round-trip por chunk em vez de 1 por campanha.
      // O loop linha-a-linha antigo (2303 × ~145ms us-central1→são paulo)
      // passava dos 300s do LB e o scan nunca terminava.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (let i = 0; i < mappedCampaigns.length; i += UPSERT_CHUNK_SIZE) {
          const chunk = mappedCampaigns.slice(i, i + UPSERT_CHUNK_SIZE);
          await client.query(
            `INSERT INTO redtrack_campaign_selections (campaign_id, campaign_name, status, is_selected)
             SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::boolean[])
             ON CONFLICT (campaign_id) DO UPDATE SET
               campaign_name = EXCLUDED.campaign_name,
               status = EXCLUDED.status;`,
            [
              chunk.map(c => c.campaign_id),
              chunk.map(c => c.campaign_name),
              chunk.map(c => c.status),
              chunk.map(c => c.is_selected),
            ]
          );
        }
        await client.query('COMMIT');
      } catch(err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    return { success: true, count: mappedCampaigns.length, campaigns: mappedCampaigns };
  } catch (error: any) {
    console.error("Erro em fetchAndSyncRedTrackCampaigns:", error);
    throw error;
  }
}
