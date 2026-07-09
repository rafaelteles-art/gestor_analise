import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { todayStr, daysAgoStr } from '@/lib/timezone';
import {
  aggregateCreativeRows,
  aggregateCreativeWindows,
  type Sub3AdRow,
} from '@/lib/creative-breakdown';

/**
 * POST /api/import/creative-breakdown
 *
 * Lado RedTrack do Creative Breakdown (ADR-0011): fatia o cache diário
 * rt_sub3_ad:{rtCampaignId} pelos campaign_ids de uma linha do dashboard v2 e
 * devolve, numa resposta só:
 *   - rows: dinheiro por criativo no período selecionado (dropdown)
 *   - windows: janelas Hoje/2D/3D/7D/14D/30D+HOJE por criativo (hover)
 *
 * Body: { campaignIds: string[], rtCampaignIds: string[], dateFrom, dateTo }
 * Lê exclusivamente do banco — o cache é populado por rt-bulk / sync-today.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const campaignIds: string[] = Array.isArray(body.campaignIds)
      ? body.campaignIds.filter((x: any) => typeof x === 'string' && x.length > 0)
      : [];
    const rtCampaignIds: string[] = Array.isArray(body.rtCampaignIds)
      ? body.rtCampaignIds.filter((x: any) => typeof x === 'string' && x.length > 0)
      : [];
    const dateFrom: string = typeof body.dateFrom === 'string' ? body.dateFrom : '';
    const dateTo: string = typeof body.dateTo === 'string' ? body.dateTo : '';

    if (campaignIds.length === 0 || rtCampaignIds.length === 0 || !dateFrom || !dateTo) {
      return NextResponse.json({ error: 'Parâmetros insuficientes' }, { status: 400 });
    }

    const today = todayStr();
    const d29ago = daysAgoStr(29);
    // Precisa cobrir o período do dropdown E as janelas do hover.
    const minDate = dateFrom < d29ago ? dateFrom : d29ago;

    const RANGES = [
      { label: 'Hoje',     dateFrom: today },
      { label: '2D',       dateFrom: daysAgoStr(1) },
      { label: '3D',       dateFrom: daysAgoStr(2) },
      { label: '7D',       dateFrom: daysAgoStr(6) },
      { label: '14D',      dateFrom: daysAgoStr(13) },
      { label: '30D+HOJE', dateFrom: d29ago },
    ];

    const keys = rtCampaignIds.map((id) => `rt_sub3_ad:${id}`);

    // Unnest em SQL (mesmo padrão do /api/history): só as entradas dos sub3 da
    // linha (+ rt_ad vazio, que vira a linha "(não rastreado)") saem do banco.
    const flat = await pool.query<Sub3AdRow>(
      `SELECT
         to_char(ic.date_from, 'YYYY-MM-DD')                       AS date,
         COALESCE(entry->>'sub3',  '')                             AS sub3,
         COALESCE(entry->>'rt_ad', '')                             AS rt_ad,
         COALESCE(NULLIF(entry->>'cost',          '')::float, 0)   AS cost,
         COALESCE(NULLIF(entry->>'total_revenue', '')::float, 0)   AS total_revenue,
         COALESCE(NULLIF(entry->>'convtype1',     '')::int,   0)   AS convtype1,
         COALESCE(NULLIF(entry->>'convtype2',     '')::int,   0)   AS convtype2
       FROM import_cache ic,
            jsonb_array_elements(ic.data) entry
       WHERE ic.cache_key = ANY($1)
         AND ic.date_from >= $2
         AND ic.date_from = ic.date_to
         AND COALESCE(entry->>'sub3', '') = ANY($3)`,
      [keys, minDate, campaignIds]
    );

    const rows = aggregateCreativeRows(flat.rows, campaignIds, dateFrom, dateTo);
    const windows = aggregateCreativeWindows(flat.rows, campaignIds, RANGES);

    return NextResponse.json({ rows, windows });
  } catch (error: any) {
    console.error('[CreativeBreakdown Error]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
