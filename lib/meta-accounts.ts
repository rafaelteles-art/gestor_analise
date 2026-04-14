import { pool } from './db';

const API_VERSION = 'v19.0';

// Mapeamento dos códigos de status da Meta para strings legíveis
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

// Busca todas as páginas de um endpoint paginado do Meta Graph API.
// Não para em erros de página individual — loga e retorna o que já coletou.
async function fetchAllPages(url: string): Promise<any[]> {
  const results: any[] = [];
  let nextUrl: string | null = url;

  while (nextUrl) {
    let res: Response;
    try {
      res = await fetch(nextUrl);
    } catch (networkErr) {
      console.warn(`Meta API network error: ${networkErr}`);
      break;
    }

    const data: any = await res.json();

    if (data.error) {
      // Erro de permissão (código 200/10) é esperado para alguns BMs — não trava o loop
      console.warn(`Meta API error (${data.error.code}): ${data.error.message}`);
      break;
    }

    if (data.data) results.push(...data.data);
    nextUrl = data.paging?.next ?? null;
  }

  return results;
}

// Extrai os últimos 4 dígitos do cartão a partir do display_string retornado pela Meta
// Ex: "Visa •••• 4242" → "4242" | "MasterCard ending in 5678" → "5678"
function parseCardDigits(displayString: string | undefined | null): string | null {
  if (!displayString) return null;
  const matches = displayString.match(/\d{4}/g);
  return matches ? matches[matches.length - 1] : null;
}

// Busca ad accounts de um BM — tenta client_ad_accounts E owned_ad_accounts
async function fetchBmAdAccounts(bmId: string, token: string): Promise<any[]> {
  const fields = 'account_id,name,account_status,currency,timezone_name,funding_source_details{display_string}';
  const [clientAccounts, ownedAccounts] = await Promise.all([
    fetchAllPages(`https://graph.facebook.com/${API_VERSION}/${bmId}/client_ad_accounts?fields=${fields}&limit=200&access_token=${token}`),
    fetchAllPages(`https://graph.facebook.com/${API_VERSION}/${bmId}/owned_ad_accounts?fields=${fields}&limit=200&access_token=${token}`),
  ]);
  return [...clientAccounts, ...ownedAccounts];
}

export async function fetchAndSyncMetaAccounts(onProgress?: (message: string) => void) {
  const report = (msg: string) => { try { onProgress?.(msg); } catch {} };
  let profiles: {name: string, token: string}[] = [];

  try {
    if (process.env.META_PROFILES) {
      profiles = JSON.parse(process.env.META_PROFILES);
    } else if (process.env.META_ACCESS_TOKEN) {
      profiles = [{ name: 'Default', token: process.env.META_ACCESS_TOKEN }];
    }
  } catch(e) {}

  if (profiles.length === 0) {
    throw new Error("META_PROFILES não configurado no .env");
  }

  try {
    const validAccounts: any[] = [];

    for (const profile of profiles) {
      const token = profile.token;
      if (!token) continue;

      console.log(`Buscando contas para o Perfil: ${profile.name}`);
      report(`Perfil ${profile.name}: buscando contas pessoais…`);

      // 1. Contas pessoais vinculadas ao usuário (com paginação)
      const personalAccounts = await fetchAllPages(
        `https://graph.facebook.com/${API_VERSION}/me/adaccounts?fields=account_id,name,account_status,currency,timezone_name,funding_source_details{display_string}&limit=200&access_token=${token}`
      );
      personalAccounts.forEach((acc: any) => {
        validAccounts.push({
          account_id: `act_${acc.account_id}`,
          account_name: acc.name || `Account ${acc.account_id}`,
          bm_id: 'Personal',
          bm_name: `Personal (${profile.name})`,
          is_selected: false,
          access_token: token,
          account_status: mapMetaStatus(acc.account_status),
          moeda: acc.currency || 'BRL',
          timezone: acc.timezone_name || null,
          cartao: parseCardDigits(acc.funding_source_details?.display_string),
        });
      });

      report(`Perfil ${profile.name}: ${personalAccounts.length} contas pessoais. Buscando BMs…`);

      // 2. Business Managers onde o usuário é membro direto
      const directBms = await fetchAllPages(
        `https://graph.facebook.com/${API_VERSION}/me/businesses?fields=id,name&limit=200&access_token=${token}`
      );

      // 3. Para cada BM direto, busca também as owned_businesses (sub-BMs filhas)
      //    Isso captura BMs que não aparecem diretamente em /me/businesses
      const allBmMap = new Map<string, { id: string; name: string }>();
      for (const bm of directBms) {
        allBmMap.set(bm.id, bm);
      }

      for (const bm of directBms) {
        const ownedBms = await fetchAllPages(
          `https://graph.facebook.com/${API_VERSION}/${bm.id}/owned_businesses?fields=id,name&limit=200&access_token=${token}`
        );
        for (const ob of ownedBms) {
          if (!allBmMap.has(ob.id)) {
            console.log(`  → Sub-BM descoberta via ${bm.name}: ${ob.name}`);
            allBmMap.set(ob.id, ob);
          }
        }
      }

      const allBms = Array.from(allBmMap.values());
      console.log(`Total de BMs encontrados para ${profile.name}: ${allBms.length}`);
      report(`Perfil ${profile.name}: ${allBms.length} BMs encontrados`);

      // 4. Para cada BM (direto ou cliente), buscar owned + client ad accounts
      let bmIndex = 0;
      for (const bm of allBms) {
        bmIndex++;
        console.log(`Buscando contas do BM: ${bm.name} (${bm.id})`);
        report(`BM ${bmIndex}/${allBms.length}: ${bm.name}`);

        const bmAccounts = await fetchBmAdAccounts(bm.id, token);
        bmAccounts.forEach((acc: any) => {
          validAccounts.push({
            account_id: `act_${acc.account_id}`,
            account_name: acc.name || `Account ${acc.account_id}`,
            bm_id: bm.id,
            bm_name: bm.name,
            is_selected: false,
            access_token: token,
            account_status: mapMetaStatus(acc.account_status),
            moeda: acc.currency || 'BRL',
            timezone: acc.timezone_name || null,
            cartao: parseCardDigits(acc.funding_source_details?.display_string),
          });
        });
      }
    }

    // Deduplicar: se uma conta aparecer em Personal E em uma BM real, a BM vence.
    // Percorre todos os registros e substitui a entrada Personal quando encontra a versão BM.
    const accountMap = new Map<string, any>();
    for (const account of validAccounts) {
      const existing = accountMap.get(account.account_id);
      if (!existing) {
        accountMap.set(account.account_id, account);
      } else if (existing.bm_id === 'Personal' && account.bm_id !== 'Personal') {
        // Substitui Personal pela entrada com BM real
        accountMap.set(account.account_id, account);
      }
    }
    const uniqueAccounts = Array.from(accountMap.values());

    report(`Salvando ${uniqueAccounts.length} contas no banco…`);

    if (uniqueAccounts.length > 0) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const account of uniqueAccounts) {
          await client.query(
            `INSERT INTO meta_ad_accounts (account_id, account_name, bm_id, bm_name, is_selected, access_token, account_status, moeda, cartao, timezone)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (account_id) DO UPDATE SET
               account_name    = EXCLUDED.account_name,
               bm_id           = CASE
                                   WHEN meta_ad_accounts.bm_id = 'Personal' THEN EXCLUDED.bm_id
                                   WHEN EXCLUDED.bm_id = 'Personal'         THEN meta_ad_accounts.bm_id
                                   ELSE EXCLUDED.bm_id
                                 END,
               bm_name         = CASE
                                   WHEN meta_ad_accounts.bm_id = 'Personal' THEN EXCLUDED.bm_name
                                   WHEN EXCLUDED.bm_id = 'Personal'         THEN meta_ad_accounts.bm_name
                                   ELSE EXCLUDED.bm_name
                                 END,
               access_token    = EXCLUDED.access_token,
               account_status  = EXCLUDED.account_status,
               moeda           = EXCLUDED.moeda,
               cartao          = COALESCE(EXCLUDED.cartao, meta_ad_accounts.cartao),
               timezone        = COALESCE(EXCLUDED.timezone, meta_ad_accounts.timezone);`,
            [
              account.account_id,
              account.account_name,
              account.bm_id,
              account.bm_name,
              account.is_selected,
              account.access_token,
              account.account_status,
              account.moeda,
              account.cartao ?? null,
              account.timezone ?? null,
            ]
          );
        }
        await client.query('COMMIT');
      } catch(err) {
        await client.query('ROLLBACK');
        console.error("Erro salvando contas no Postgres:", err);
        throw err;
      } finally {
        client.release();
      }
    }

    return { success: true, count: uniqueAccounts.length, accounts: uniqueAccounts };
  } catch (error: any) {
    console.error("Erro em fetchAndSyncMetaAccounts:", error);
    throw error;
  }
}
