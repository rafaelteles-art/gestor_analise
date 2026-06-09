import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { todayStr } from '@/lib/timezone';
import { parseOfertaParam } from '@/lib/offer-scope';

/**
 * GET /api/overview/db?date=YYYY-MM-DD
 *
 * Lê do banco (redtrack_metrics) as métricas das campanhas selecionadas em Configurações,
 * para a data informada. NÃO bate na API do RedTrack — apenas relê o que já foi
 * sincronizado (via /api/overview/sync-today ou via /api/cron/daily-sync).
 *
 * Retorna sempre TODAS as campanhas selecionadas (com zeros se sem row na data).
 */
export async function GET(req: NextRequest) {
  const dateRaw = req.nextUrl.searchParams.get('date');
  const dateStr = dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw)
    ? dateRaw
    : todayStr();

  const ofertaId = parseOfertaParam(req.nextUrl.searchParams.get('oferta'));

  try {
    const scopeSql = ofertaId == null
      ? `WHERE s.oferta_id IN (SELECT id FROM ofertas WHERE status = 'ATIVO')`
      : `WHERE s.oferta_id = $2`;
    const sql = `
      SELECT
        s.campaign_id,
        s.campaign_name,
        s.status,
        COALESCE(m.cost, 0)           AS cost,
        COALESCE(m.total_revenue, 0)  AS total_revenue,
        COALESCE(m.profit, 0)         AS profit,
        COALESCE(m.roas, 0)           AS roas,
        COALESCE(m.ic_count, 0)       AS ic_count,
        COALESCE(m.purchase_count, 0) AS purchase_count,
        COALESCE(m.up1_count, 0)      AS up1_count,
        COALESCE(m.up2_count, 0)      AS up2_count,
        COALESCE(m.up3_count, 0)      AS up3_count,
        COALESCE(m.up4_count, 0)      AS up4_count,
        m.synced_at,
        (m.campaign_id IS NOT NULL)   AS has_data
      FROM redtrack_campaign_selections s
      LEFT JOIN redtrack_metrics m
        ON m.campaign_id = s.campaign_id AND m.date = $1
      ${scopeSql}
      ORDER BY s.campaign_name ASC;
    `;
    const params = ofertaId == null ? [dateStr] : [dateStr, ofertaId];
    const res = await pool.query(sql, params);

    // Coerções defensivas (numéricos do pg vêm como string)
    const rows = res.rows.map(r => ({
      campaign_id:    r.campaign_id,
      campaign_name:  r.campaign_name,
      status:         r.status,
      cost:           parseFloat(r.cost)           || 0,
      total_revenue:  parseFloat(r.total_revenue)  || 0,
      profit:         parseFloat(r.profit)         || 0,
      roas:           parseFloat(r.roas)           || 0,
      ic_count:       parseInt(r.ic_count, 10)       || 0,
      purchase_count: parseInt(r.purchase_count, 10) || 0,
      up1_count:      parseInt(r.up1_count, 10)      || 0,
      up2_count:      parseInt(r.up2_count, 10)      || 0,
      up3_count:      parseInt(r.up3_count, 10)      || 0,
      up4_count:      parseInt(r.up4_count, 10)      || 0,
      synced_at:      r.synced_at,
      has_data:       r.has_data,
    }));

    const totals = rows.reduce((acc, r) => {
      acc.cost           += r.cost;
      acc.total_revenue  += r.total_revenue;
      acc.profit         += r.profit;
      acc.ic_count       += r.ic_count;
      acc.purchase_count += r.purchase_count;
      acc.up1_count      += r.up1_count;
      acc.up2_count      += r.up2_count;
      acc.up3_count      += r.up3_count;
      acc.up4_count      += r.up4_count;
      return acc;
    }, { cost: 0, total_revenue: 0, profit: 0, ic_count: 0, purchase_count: 0,
         up1_count: 0, up2_count: 0, up3_count: 0, up4_count: 0 } as any);

    totals.roas = totals.cost > 0 ? totals.total_revenue / totals.cost : 0;

    return NextResponse.json({
      success: true,
      date: dateStr,
      rows,
      totals,
      rowCount: rows.length,
    });
  } catch (err: any) {
    // Se as colunas convtype ainda não existem, devolve erro orientativo
    if (err?.code === '42703') {
      return NextResponse.json({
        error: 'Colunas de tipo de conversão ainda não existem em redtrack_metrics. ' +
               'Clique em "Sincronizar pela API" — a primeira execução cria as colunas automaticamente.',
      }, { status: 409 });
    }
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}
