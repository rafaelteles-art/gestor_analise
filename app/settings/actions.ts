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

// Toggle todas as contas de um BM específico
export async function toggleBmSelection(bmId: string, newStatus: boolean) {
  try {
    await pool.query(
      'UPDATE meta_ad_accounts SET is_selected = $1 WHERE bm_id = $2',
      [newStatus, bmId]
    );
  } catch (error: any) {
    throw new Error(error.message);
  }
}

// Substitui a seleção de campanhas RT:
// Desativa todas e ativa somente as IDs recebidas.
export async function setRtCampaignSelections(selectedIds: string[]) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE redtrack_campaign_selections SET is_selected = false');
    if (selectedIds.length > 0) {
      // $1 = array de IDs; usa = ANY para update em lote
      await client.query(
        'UPDATE redtrack_campaign_selections SET is_selected = true WHERE campaign_id = ANY($1)',
        [selectedIds]
      );
    }
    await client.query('COMMIT');
  } catch (error: any) {
    await client.query('ROLLBACK');
    throw new Error(error.message);
  } finally {
    client.release();
  }
}
