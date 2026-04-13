export interface MetaAdMetric {
  date: string;
  account_id: string;
  campaign_id: string;
  campaign_name: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;
  cpm: number;
}

export async function fetchMetaMetrics(
  adAccountId: string,
  dateFrom: string,
  dateTo: string,
  accessToken?: string
): Promise<MetaAdMetric[]> {
  const token = accessToken || process.env.META_ACCESS_TOKEN;

  if (!token || !adAccountId || !dateFrom || !dateTo) {
    console.error(`Meta API credentials missing for account: ${adAccountId}`);
    return [];
  }

  const fields = 'campaign_id,campaign_name,spend,impressions,clicks,actions,cpm,ctr';
  let url: string | null = `https://graph.facebook.com/v19.0/${adAccountId}/insights?fields=${fields}&time_range={'since':'${dateFrom}','until':'${dateTo}'}&level=campaign&limit=500&access_token=${token}`;

  const allResults: MetaAdMetric[] = [];

  try {
    while (url) {
      const res: Response = await fetch(url);
      const data: any = await res.json();
      
      if (data.error) {
        const msg = data.error.message ?? JSON.stringify(data.error);
        console.warn(`Meta API error for ${adAccountId}: ${msg}`);
        throw new Error(msg);
      }
      
      if (!data.data) break;

      const pageResults = data.data.map((item: any) => {
        const conversions = item.actions?.find((a: any) => a.action_type === 'purchase' || a.action_type === 'lead')?.value || 0;

        return {
          date: item.date_start,
          account_id: adAccountId,
          campaign_id: item.campaign_id,
          campaign_name: item.campaign_name,
          spend: parseFloat(item.spend || '0'),
          impressions: parseInt(item.impressions || '0', 10),
          clicks: parseInt(item.clicks || '0', 10),
          conversions: parseInt(conversions, 10),
          ctr: parseFloat(item.ctr || '0'),
          cpm: parseFloat(item.cpm || '0')
        };
      });

      allResults.push(...pageResults);

      // Paginação do Facebook
      url = data.paging?.next || null;
    }

    console.log(`[Meta] ${adAccountId}: ${allResults.length} campanhas encontradas`);
    return allResults;
  } catch (error) {
    console.error(`Failed to fetch Meta metrics for ${adAccountId}:`, error);
    return allResults;
  }
}

/**
 * Igual a fetchMetaMetrics, mas com time_increment=1 → retorna uma linha por (dia, campanha).
 * Usado para popular a tabela meta_ads_metrics com dados históricos diários.
 */
export async function fetchMetaMetricsPerDay(
  adAccountId: string,
  dateFrom: string,
  dateTo: string,
  accessToken?: string
): Promise<MetaAdMetric[]> {
  const token = accessToken || process.env.META_ACCESS_TOKEN;

  if (!token || !adAccountId || !dateFrom || !dateTo) {
    console.error(`[Meta] Credenciais ausentes para a conta: ${adAccountId}`);
    return [];
  }

  const fields = 'campaign_id,campaign_name,spend,impressions,clicks,actions,cpm,ctr';
  let url: string | null =
    `https://graph.facebook.com/v19.0/${adAccountId}/insights` +
    `?fields=${fields}` +
    `&time_range={'since':'${dateFrom}','until':'${dateTo}'}` +
    `&time_increment=1` +
    `&level=campaign` +
    `&limit=500` +
    `&access_token=${token}`;

  const allResults: MetaAdMetric[] = [];

  try {
    while (url) {
      const res: Response = await fetch(url);
      const data: any = await res.json();

      if (data.error) {
        const msg = data.error.message ?? JSON.stringify(data.error);
        console.warn(`[Meta] Erro na conta ${adAccountId}: ${msg}`);
        throw new Error(msg);
      }

      if (!data.data) break;

      const pageResults = data.data.map((item: any) => {
        const conversions =
          item.actions?.find((a: any) => a.action_type === 'purchase' || a.action_type === 'lead')?.value || 0;

        return {
          date: item.date_start,
          account_id: adAccountId,
          campaign_id: item.campaign_id,
          campaign_name: item.campaign_name,
          spend: parseFloat(item.spend || '0'),
          impressions: parseInt(item.impressions || '0', 10),
          clicks: parseInt(item.clicks || '0', 10),
          conversions: parseInt(conversions, 10),
          ctr: parseFloat(item.ctr || '0'),
          cpm: parseFloat(item.cpm || '0'),
        };
      });

      allResults.push(...pageResults);
      url = data.paging?.next || null;
    }

    console.log(`[Meta] ${adAccountId}: ${allResults.length} linhas diárias (${dateFrom} → ${dateTo})`);
    return allResults;
  } catch (error) {
    console.error(`[Meta] Falha no fetch diário para ${adAccountId}:`, error);
    return allResults;
  }
}
