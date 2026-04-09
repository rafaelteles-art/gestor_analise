/* ─── Meta Ads Types ─── */
export interface MetaAdMetric {
  id?: string;
  campaign_id: string;
  campaign_name: string;
  adset_name: string | null;
  ad_name: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  cpc: number;
  cpm: number;
  ctr: number;
  conversions: number;
  cost_per_conversion: number;
  date_start: string;
  date_stop: string;
  account_id: string;
  fetched_at?: string;
}

/* ─── RedTrack Types ─── */
export interface RedTrackMetric {
  id?: string;
  campaign_id: string;
  campaign_name: string;
  clicks: number;
  lp_clicks: number;
  conversions: number;
  revenue: number;
  cost: number;
  profit: number;
  roi: number;
  epc: number;
  date: string;
  fetched_at?: string;
}

/* ─── Dashboard Summary ─── */
export interface DashboardSummary {
  totalSpend: number;
  totalRevenue: number;
  totalProfit: number;
  totalConversions: number;
  avgROI: number;
  avgCPC: number;
}
