import { NextRequest, NextResponse } from 'next/server';
import { getRedtrackApiKey } from '@/lib/config';
import { pool } from '@/lib/db';
import { format } from 'date-fns';

/**
 * GET /api/overview/ads?campaign_id=...&date=YYYY-MM-DD&fresh=1
 *
 * Lista os rt_ads (criativos) de uma campanha do RedTrack para a data informada.
 *
 * Estratégia:
 *  - Se `fresh=1` ou não houver cache em import_cache, busca direto da API
 *    (group=rt_ad) e atualiza o cache.
 *  - Senão devolve do cache (`rt_ad:{campaign_id}` em import_cache).
 */
export async function GET(req: NextRequest) {
  const campaignId = req.nextUrl.searchParams.get('campaign_id');
  const dateRaw = req.nextUrl.searchParams.get('date');
  const fresh = req.nextUrl.searchParams.get('fresh') === '1';

  if (!campaignId) {
    return NextResponse.json({ error: 'campaign_id é obrigatório.' }, { status: 400 });
  }
  const dateStr = dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw)
    ? dateRaw
    : format(new Date(), 'yyyy-MM-dd');

  const cacheKey = `rt_ad:${campaignId}`;

  // 1. Tenta cache primeiro (a menos que fresh=1)
  if (!fresh) {
    try {
      const cached = await pool.query(
        `SELECT data, synced_at FROM import_cache
         WHERE cache_key = $1 AND date_from = $2 AND date_to = $2
         LIMIT 1`,
        [cacheKey, dateStr],
      );
      if (cached.rows.length > 0) {
        const arr = Array.isArray(cached.rows[0].data) ? cached.rows[0].data : [];
        return NextResponse.json({
          success: true,
          source: 'cache',
          date: dateStr,
          campaign_id: campaignId,
          synced_at: cached.rows[0].synced_at,
          ads: arr.map(normalizeAd),
        });
      }
    } catch {
      // segue para fetch direto
    }
  }

  // 2. Busca da API e atualiza cache
  const apiKey = await getRedtrackApiKey();
  if (!apiKey) {
    return NextResponse.json({ error: 'REDTRACK_API_KEY não configurada.' }, { status: 500 });
  }

  try {
    const url = `https://api.redtrack.io/report?api_key=${apiKey}` +
                `&date_from=${dateStr}&date_to=${dateStr}` +
                `&tz=America/Sao_Paulo&group=rt_ad&campaign_id=${campaignId}` +
                `&per=1000&page=1`;

    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return NextResponse.json(
        { error: `RedTrack HTTP ${res.status}: ${txt.slice(0, 200)}` },
        { status: 502 },
      );
    }
    const data = await res.json();
    const arr = Array.isArray(data) ? data : (data?.data || []);

    // Atualiza cache
    try {
      await pool.query(
        `INSERT INTO import_cache (cache_key, date_from, date_to, data, synced_at)
         VALUES ($1, $2, $2, $3, NOW())
         ON CONFLICT (cache_key, date_from, date_to)
         DO UPDATE SET data = EXCLUDED.data, synced_at = NOW();`,
        [cacheKey, dateStr, JSON.stringify(arr)],
      );
    } catch {
      // se cache falhar, segue retornando os dados
    }

    return NextResponse.json({
      success: true,
      source: 'live',
      date: dateStr,
      campaign_id: campaignId,
      synced_at: new Date().toISOString(),
      ads: arr.map(normalizeAd),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }
}

function normalizeAd(item: any) {
  const num = (v: any) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const intNum = (v: any) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
  return {
    rt_ad:             String(item.rt_ad ?? '').trim() || '(sem rt_ad)',
    cost:              num(item.cost),
    total_revenue:     num(item.total_revenue),
    profit:            num(item.profit),
    roas:              num(item.roas),
    clicks:            intNum(item.clicks),
    conversions:       intNum(item.conversions),
    total_conversions: intNum(item.total_conversions),
    ic_count:          intNum(item.convtype1),
    purchase_count:    intNum(item.convtype2),
    up1_count:         intNum(item.convtype3),
    up2_count:         intNum(item.convtype4),
    up3_count:         intNum(item.convtype5),
    up4_count:         intNum(item.convtype11),
  };
}
