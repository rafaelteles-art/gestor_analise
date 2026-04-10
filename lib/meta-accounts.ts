import { pool } from './db';

const API_VERSION = 'v19.0';

export async function fetchAndSyncMetaAccounts() {
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
      
      // 1. Fetch personal ad accounts directly linked to the user
      const meRes = await fetch(`https://graph.facebook.com/${API_VERSION}/me/adaccounts?fields=account_id,name&access_token=${token}`);
      if (meRes.ok) {
        const meData = await meRes.json();
        if (meData.data) {
          meData.data.forEach((acc: any) => {
            validAccounts.push({
              account_id: `act_${acc.account_id}`,
              account_name: acc.name || `Account ${acc.account_id}`,
              bm_id: 'Personal',
              bm_name: `Personal (${profile.name})`,
              is_selected: false, // padrao
              access_token: token
            });
          });
        }
      }

      // 2. Fetch Business Managers
      const bmRes = await fetch(`https://graph.facebook.com/${API_VERSION}/me/businesses?fields=id,name&access_token=${token}`);
      
      if (bmRes.ok) {
        const bmData = await bmRes.json();
        const bms = bmData.data || [];

        // 3. Para cada BM, buscar client_ad_accounts e owned_ad_accounts
        for (const bm of bms) {
          console.log(`Buscando contas do BM: ${bm.name}`);
          
          // Puxa contas do cliente associadas ao BM
          const clientAccRes = await fetch(`https://graph.facebook.com/${API_VERSION}/${bm.id}/client_ad_accounts?fields=account_id,name&access_token=${token}`);
          if (clientAccRes.ok) {
            const clientAccData = await clientAccRes.json();
            clientAccData.data?.forEach((acc: any) => {
              validAccounts.push({
                account_id: `act_${acc.account_id}`,
                account_name: acc.name || `Account ${acc.account_id}`,
                bm_id: bm.id,
                bm_name: bm.name,
                is_selected: false,
                access_token: token
              });
            });
          }
          
          // Puxa contas pertencentes diretamente ao BM
          const ownedAccRes = await fetch(`https://graph.facebook.com/${API_VERSION}/${bm.id}/owned_ad_accounts?fields=account_id,name&access_token=${token}`);
          if (ownedAccRes.ok) {
              const ownedAccData = await ownedAccRes.json();
              ownedAccData.data?.forEach((acc: any) => {
                validAccounts.push({
                  account_id: `act_${acc.account_id}`,
                  account_name: acc.name || `Account ${acc.account_id}`,
                  bm_id: bm.id,
                  bm_name: bm.name,
                  is_selected: false,
                  access_token: token
                });
              });
            }
        }
      }
    }

    // Remover duplicatas baseadas no account_id (pois algumas podem vir no 'me' e no 'bm')
    const uniqueAccounts = validAccounts.filter((value, index, self) =>
        index === self.findIndex((t) => (
            t.account_id === value.account_id
        ))
    );

    if (uniqueAccounts.length > 0) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const account of uniqueAccounts) {
          await client.query(
            `INSERT INTO meta_ad_accounts (account_id, account_name, bm_id, bm_name, is_selected, access_token)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (account_id) DO UPDATE SET
               account_name = EXCLUDED.account_name,
               bm_id = EXCLUDED.bm_id,
               bm_name = EXCLUDED.bm_name,
               access_token = EXCLUDED.access_token;`,
            [account.account_id, account.account_name, account.bm_id, account.bm_name, account.is_selected, account.access_token]
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
