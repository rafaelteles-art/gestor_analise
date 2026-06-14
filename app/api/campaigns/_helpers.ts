import { pool } from '@/lib/db';
import { getMetaProfiles } from '@/lib/config';

export interface AccountAuth {
  account_id: string;
  account_name: string;
  access_token: string;
  nickname: string | null;
}

/**
 * Busca uma conta Meta + seu access_token a partir do account_id (formato act_xxx).
 * Devolve null se a conta não existir ou não tiver token válido.
 */
export async function loadAccountAuth(accountId: string): Promise<AccountAuth | null> {
  const res = await pool.query(
    `SELECT account_id, account_name, access_token, nickname
       FROM meta_ad_accounts
      WHERE account_id = $1
      LIMIT 1`,
    [accountId]
  );
  const row = res.rows[0];
  if (!row?.access_token) return null;
  return row as AccountAuth;
}

/**
 * Resolve o token a usar:
 *  - Se `profileName` foi enviado, busca o token do perfil correspondente em META_PROFILES.
 *  - Caso contrário, cai no token armazenado na linha de meta_ad_accounts.
 *
 * Devolve `{ token, account_name }` ou `null` se nada serviu.
 */
export async function resolveAuth(
  accountId: string,
  profileName?: string | null
): Promise<{ token: string; account_name: string; nickname: string | null } | null> {
  const account = await loadAccountAuth(accountId);
  const accountName = account?.account_name ?? accountId;
  const nickname = account?.nickname ?? null;

  if (profileName) {
    const profiles = await getMetaProfiles();
    const match = profiles.find((p) => p.name === profileName);
    if (match?.token) return { token: match.token, account_name: accountName, nickname };
    return null;
  }

  if (account?.access_token) return { token: account.access_token, account_name: accountName, nickname };
  return null;
}
