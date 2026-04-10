'use server'

import { pool } from '@/lib/db';

// Toggle the is_selected flag for a specific account
export async function toggleAccountSelection(accountId: string, newStatus: boolean) {
  try {
    await pool.query(
      'UPDATE meta_ad_accounts SET is_selected = $1 WHERE account_id = $2',
      [newStatus, accountId]
    );
  } catch (error: any) {
    throw new Error(error.message);
  }
}

// Bulk toggle the is_selected flag for all accounts
export async function toggleAllAccountsSelection(newStatus: boolean) {
  try {
    await pool.query(
      'UPDATE meta_ad_accounts SET is_selected = $1 WHERE is_selected != $1',
      [newStatus]
    );
  } catch (error: any) {
    throw new Error(error.message);
  }
}
