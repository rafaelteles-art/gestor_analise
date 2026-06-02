'use server'

import { revalidatePath } from 'next/cache';
import { pool } from '@/lib/db';

// Adiciona ou remove uma conta da blacklist (oculta de /status-contas)
export async function toggleAccountBlacklist(accountId: string, blacklisted: boolean) {
  try {
    await pool.query(
      'UPDATE meta_ad_accounts SET is_blacklisted = $1 WHERE account_id = $2',
      [blacklisted, accountId]
    );
    revalidatePath('/settings');
    revalidatePath('/status-contas');
  } catch (error: any) {
    throw new Error(error.message);
  }
}

// Adiciona ou remove um BM inteiro da blacklist
export async function toggleBmBlacklist(bmId: string, bmName: string, blacklisted: boolean) {
  try {
    if (blacklisted) {
      await pool.query(
        `INSERT INTO meta_bm_blacklist (bm_id, bm_name) VALUES ($1, $2)
         ON CONFLICT (bm_id) DO UPDATE SET bm_name = EXCLUDED.bm_name`,
        [bmId, bmName]
      );
    } else {
      await pool.query('DELETE FROM meta_bm_blacklist WHERE bm_id = $1', [bmId]);
    }
    revalidatePath('/settings');
    revalidatePath('/status-contas');
  } catch (error: any) {
    throw new Error(error.message);
  }
}
