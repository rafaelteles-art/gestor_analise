import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

const API_VERSION = 'v19.0';

const META_STATUS_MAP: Record<number, string> = {
  1:   'ACTIVE',
  2:   'DISABLED',
  3:   'UNSETTLED',
  7:   'PENDING_REVIEW',
  8:   'PENDING_CLOSURE',
  9:   'IN_GRACE_PERIOD',
  101: 'TEMPORARILY_UNAVAILABLE',
  201: 'CLOSED',
};

function mapMetaStatus(code: number | undefined): string {
  if (code === undefined || code === null) return 'UNKNOWN';
  return META_STATUS_MAP[code] ?? `STATUS_${code}`;
}

export async function GET() {
  try {
    // Busca todas as contas com token de acesso salvo
    const { rows: accounts } = await pool.query(
      `SELECT account_id, access_token FROM meta_ad_accounts
       WHERE access_token IS NOT NULL AND access_token <> ''`
    );

    if (accounts.length === 0) {
      return NextResponse.json({
        success: true,
        updated: 0,
        message: 'Nenhuma conta com token encontrada.',
      });
    }

    // Agrupa IDs por token para minimizar chamadas à API
    const tokenMap = new Map<string, string[]>();
    for (const row of accounts) {
      const token: string = row.access_token;
      if (!tokenMap.has(token)) tokenMap.set(token, []);
      tokenMap.get(token)!.push(row.account_id);
    }

    let updatedCount = 0;
    const BATCH_SIZE = 50;

    for (const [token, accountIds] of tokenMap) {
      for (let i = 0; i < accountIds.length; i += BATCH_SIZE) {
        const batch = accountIds.slice(i, i + BATCH_SIZE);

        // Usa batch request do Meta Graph API para buscar status + gastos de várias contas de uma vez
        const batchRequests = batch.map(accountId => ({
          method: 'GET',
          relative_url: `${accountId}?fields=account_status,amount_spent,spend_cap,timezone_name`,
        }));

        let res: Response;
        try {
          res = await fetch(`https://graph.facebook.com/${API_VERSION}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              access_token: token,
              batch: JSON.stringify(batchRequests),
            }),
          });
        } catch (networkErr) {
          console.warn('Meta batch API network error:', networkErr);
          continue;
        }

        if (!res.ok) {
          console.warn(`Meta batch API HTTP error: ${res.status}`);
          continue;
        }

        const batchResults: any[] = await res.json();

        for (let j = 0; j < batchResults.length; j++) {
          const result = batchResults[j];
          const accountId = batch[j];

          if (!result || result.code !== 200) {
            console.warn(`Erro ao buscar ${accountId}: código ${result?.code}`);
            continue;
          }

          let body: any;
          try {
            body = JSON.parse(result.body);
          } catch {
            continue;
          }

          if (body.error) {
            console.warn(`Meta API error para ${accountId}: ${body.error.message}`);
            continue;
          }

          const newStatus = mapMetaStatus(body.account_status);
          // amount_spent e spend_cap vêm em centavos (string) — NULL quando não disponível
          const gastoTotal = body.amount_spent != null ? Number(body.amount_spent) / 100 : null;
          const limite     = body.spend_cap    != null ? Number(body.spend_cap)    / 100 : null;
          const timezone   = body.timezone_name ?? null;

          await pool.query(
            `UPDATE meta_ad_accounts
             SET account_status = $1,
                 gasto_total    = COALESCE($3, gasto_total),
                 limite         = COALESCE($4, limite),
                 timezone       = COALESCE($5, timezone)
             WHERE account_id = $2`,
            [newStatus, accountId, gastoTotal, limite, timezone]
          );

          updatedCount++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      updated: updatedCount,
      message: `${updatedCount} conta${updatedCount !== 1 ? 's' : ''} atualizada${updatedCount !== 1 ? 's' : ''}.`,
    });
  } catch (error: any) {
    console.error('GET /api/status-contas/sync error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
