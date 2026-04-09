import { supabase } from './supabase';

const API_VERSION = 'v19.0';

export async function fetchAndSyncMetaAccounts() {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    throw new Error("META_ACCESS_TOKEN não configurado no .env");
  }

  try {
    const validAccounts: any[] = [];

    // 1. Fetch personal ad accounts directly linked to the user
    console.log("Buscando contas pessoais de anúncios...");
    const meRes = await fetch(`https://graph.facebook.com/${API_VERSION}/me/adaccounts?fields=account_id,name&access_token=${token}`);
    if (meRes.ok) {
      const meData = await meRes.json();
      if (meData.data) {
        meData.data.forEach((acc: any) => {
          validAccounts.push({
            account_id: `act_${acc.account_id}`,
            account_name: acc.name || `Account ${acc.account_id}`,
            bm_id: 'Personal',
            bm_name: 'Personal Account',
            is_selected: false // padrao
          });
        });
      }
    }

    // 2. Fetch Business Managers
    console.log("Buscando Business Managers...");
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
              is_selected: false
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
                is_selected: false
              });
            });
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
      // Usamos upsert no supabase para que ele grave novas e ignore atualizar is_selected das ativas
      const { error } = await supabase
        .from('meta_ad_accounts')
        .upsert(uniqueAccounts, { onConflict: 'account_id', ignoreDuplicates: true });

      if (error) {
        console.error("Erro salvando contas no Supabase:", error);
        throw new Error(error.message);
      }
    }

    return { success: true, count: uniqueAccounts.length, accounts: uniqueAccounts };
  } catch (error: any) {
    console.error("Erro em fetchAndSyncMetaAccounts:", error);
    throw error;
  }
}
