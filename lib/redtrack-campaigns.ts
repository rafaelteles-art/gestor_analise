import { supabase } from './supabase';

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
      const { error } = await supabase
        .from('redtrack_campaign_selections')
        .upsert(mappedCampaigns, { onConflict: 'campaign_id' });

      if (error) {
        throw new Error(error.message);
      }
    }

    return { success: true, count: mappedCampaigns.length, campaigns: mappedCampaigns };
  } catch (error: any) {
    console.error("Erro em fetchAndSyncRedTrackCampaigns:", error);
    throw error;
  }
}
