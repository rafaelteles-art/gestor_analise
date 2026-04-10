import { pool } from './db';

export async function fetchAndSyncRedTrackCampaigns() {
  const apiKey = process.env.REDTRACK_API_KEY;
  if (!apiKey) {
    console.log("Ignorando RedTrack scanner: API Key ausente.");
    return { success: true, count: 0, campaigns: [] };
  }

  try {
    console.log("Buscando campanhas do RedTrack...");
    const url = `https://api.redtrack.io/campaigns?api_key=${apiKey}&limit=500`;

    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json"
      }
    });

    if (!res.ok) {
        throw new Error(`RedTrack API error: ${res.statusText}`);
    }
    
    const data = await res.json();
    const campaigns = Array.isArray(data) ? data : (data.data || []);

    const mappedCampaigns = campaigns.map((c: any) => ({
      campaign_id: String(c.id),
      campaign_name: c.title || `Campaign ${c.id}`,
      status: c.status || 'unknown',
      is_selected: false
    }));

    if (mappedCampaigns.length > 0) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const camp of mappedCampaigns) {
          await client.query(
            `INSERT INTO redtrack_campaign_selections (campaign_id, campaign_name, status, is_selected)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (campaign_id) DO UPDATE SET
               campaign_name = EXCLUDED.campaign_name,
               status = EXCLUDED.status;`,
            [camp.campaign_id, camp.campaign_name, camp.status, camp.is_selected]
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
