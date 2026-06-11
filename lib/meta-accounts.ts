import { pool } from './db';
import { getMetaProfiles } from './config';

const API_VERSION = 'v19.0';

// Quantos BMs varrer em paralelo no scan. fetchBmAdAccounts já dispara 2
// requests (client+owned), então SCAN_CONCURRENCY=6 ≈ 12 requests Meta em voo.
// Conservador de propósito pra não agravar o throttle #4 da Meta. Era serial,
// o que estourava o teto de 300s do LB do App Hosting (stream cortado →
// cliente via "resposta inesperada do servidor").
const SCAN_CONCURRENCY = 6;

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

  // Lê perfis do banco (app_settings) com fallback para process.env.
  // No live os tokens são salvos via /api-config, então só process.env não basta.
  const profiles = await getMetaProfiles();

  if (profiles.length === 0) {
    throw new Error("META_PROFILES não configurado. Configure os tokens em /api-config.");
  }

  try {
    // Garante a coluna accessible_profiles (rastreia quais perfis veem cada conta).
    // É usada na página /campaigns para mostrar a mesma conta sob TODOS os perfis
    // que têm permissão a ela, mesmo após o dedup desta função.
    await pool.query(
      `ALTER TABLE meta_ad_accounts ADD COLUMN IF NOT EXISTS accessible_profiles TEXT[] DEFAULT '{}'`
    );

    // Apelido livre dado pelo usuário (A4). Não sobrescrito pelo sync — o upsert
    // abaixo usa COALESCE para preservar o valor existente.
    await pool.query(
      `ALTER TABLE meta_ad_accounts ADD COLUMN IF NOT EXISTS nickname TEXT`
    );

    const validAccounts: any[] = [];
    // Map<account_id, Set<profile_name>> — quem viu o quê (calculado ANTES do dedup)
    const accessibleByAccount = new Map<string, Set<string>>();
    const trackAccess = (accountId: string, profileName: string) => {
      if (!accessibleByAccount.has(accountId)) accessibleByAccount.set(accountId, new Set());
      accessibleByAccount.get(accountId)!.add(profileName);
    };

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
        const accountId = `act_${acc.account_id}`;
        trackAccess(accountId, profile.name);
        validAccounts.push({
          account_id: accountId,
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

      // 2. Business Managers onde o usuário é membro direto.
      //    Toda conta de campanha será atribuída a uma dessas BMs (não a sub-BMs),
      //    pra que o system user tenha permissão de publicar campanhas pela BM.
      const directBms = await fetchAllPages(
        `https://graph.facebook.com/${API_VERSION}/me/businesses?fields=id,name&limit=200&access_token=${token}`
      );

      // 3. Para cada BM direta, descobre as owned_businesses (sub-BMs filhas)
      //    e mapeia cada sub-BM de volta à BM-mãe direta. Assim, ao listar
      //    contas dessas sub-BMs, a conta é registrada sob a BM-mãe direta,
      //    onde o system user de fato tem acesso para publicar campanhas.
      const allBmMap = new Map<string, { id: string; name: string }>();
      // bmId (direta ou sub) → BM-mãe direta usada como bm_id/bm_name da conta
      const bmToParentDirect = new Map<string, { id: string; name: string }>();
      for (const bm of directBms) {
        allBmMap.set(bm.id, bm);
        bmToParentDirect.set(bm.id, bm); // BM direta é "mãe" de si mesma
      }

      // Discovery das sub-BMs em paralelo (lotes de SCAN_CONCURRENCY). Os fetches
      // correm juntos, mas as mutações dos maps são aplicadas em ordem após cada
      // lote pra preservar o "primeiro visto vence".
      for (let i = 0; i < directBms.length; i += SCAN_CONCURRENCY) {
        const batch = directBms.slice(i, i + SCAN_CONCURRENCY);
        const fetched = await Promise.all(
          batch.map(async (bm) => ({
            bm,
            ownedBms: await fetchAllPages(
              `https://graph.facebook.com/${API_VERSION}/${bm.id}/owned_businesses?fields=id,name&limit=200&access_token=${token}`
            ),
          }))
        );
        for (const { bm, ownedBms } of fetched) {
          for (const ob of ownedBms) {
            if (!allBmMap.has(ob.id)) {
              console.log(`  → Sub-BM descoberta via ${bm.name}: ${ob.name} (contas serão atribuídas a ${bm.name})`);
              allBmMap.set(ob.id, ob);
              bmToParentDirect.set(ob.id, bm); // sub-BM → BM-mãe direta
            }
          }
        }
      }

      const allBms = Array.from(allBmMap.values());
      console.log(`Total de BMs encontrados para ${profile.name}: ${allBms.length}`);
      report(`Perfil ${profile.name}: ${allBms.length} BMs encontrados`);

      // 4. Para cada BM (direta ou sub), buscar owned + client ad accounts.
      //    bm_id/bm_name salvos são SEMPRE da BM-mãe direta — nunca da sub-BM —
      //    pra garantir que o system user possa operar a conta via essa BM.
      // Busca as contas de cada BM em paralelo (lotes de SCAN_CONCURRENCY).
      // Este era o gargalo: serial × dezenas de BMs estourava os 300s do LB.
      // Os fetches correm juntos; os pushes em validAccounts são feitos em ordem
      // após cada lote (o dedup posterior é indiferente à ordem entre BMs).
      let bmDone = 0;
      for (let i = 0; i < allBms.length; i += SCAN_CONCURRENCY) {
        const batch = allBms.slice(i, i + SCAN_CONCURRENCY);
        const fetched = await Promise.all(
          batch.map(async (bm) => {
            const parent = bmToParentDirect.get(bm.id) ?? bm;
            console.log(`Buscando contas do BM: ${bm.name} (${bm.id}) [mãe direta: ${parent.name}]`);
            const accounts = await fetchBmAdAccounts(bm.id, token);
            return { parent, accounts };
          })
        );
        for (const { parent, accounts } of fetched) {
          accounts.forEach((acc: any) => {
            const accountId = `act_${acc.account_id}`;
            trackAccess(accountId, profile.name);
            validAccounts.push({
              account_id: accountId,
              account_name: acc.name || `Account ${acc.account_id}`,
              bm_id: parent.id,
              bm_name: parent.name,
              is_selected: false,
              access_token: token,
              account_status: mapMetaStatus(acc.account_status),
              moeda: acc.currency || 'BRL',
              timezone: acc.timezone_name || null,
              cartao: parseCardDigits(acc.funding_source_details?.display_string),
            });
          });
        }
        bmDone += batch.length;
        report(`BM ${bmDone}/${allBms.length}: ${batch[batch.length - 1].name}`);
      }
    }

    // Deduplicar: se uma conta aparecer em Personal E em uma BM real, a BM vence.
    // Entre múltiplas BMs reais (mesma conta visível por mais de uma BM-mãe
    // direta), mantém a primeira vista — todas são BMs onde o system user
    // pode operar, então qualquer uma serve.
    const accountMap = new Map<string, any>();
    for (const account of validAccounts) {
      const existing = accountMap.get(account.account_id);
      if (!existing) {
        accountMap.set(account.account_id, account);
      } else if (existing.bm_id === 'Personal' && account.bm_id !== 'Personal') {
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
          const profileList = Array.from(accessibleByAccount.get(account.account_id) ?? []);
          await client.query(
            `INSERT INTO meta_ad_accounts (account_id, account_name, bm_id, bm_name, is_selected, access_token, account_status, moeda, cartao, timezone, accessible_profiles)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
               timezone        = COALESCE(EXCLUDED.timezone, meta_ad_accounts.timezone),
               accessible_profiles = EXCLUDED.accessible_profiles`,
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
              profileList,
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
