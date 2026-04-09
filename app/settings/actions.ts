'use server'

import { supabase } from '@/lib/supabase';

// Toggle the is_selected flag for a specific account
export async function toggleAccountSelection(accountId: string, newStatus: boolean) {
  const { error } = await supabase
    .from('meta_ad_accounts')
    .update({ is_selected: newStatus })
    .eq('account_id', accountId);

  if (error) {
    throw new Error(error.message);
  }
}

// Bulk toggle the is_selected flag for all accounts
export async function toggleAllAccountsSelection(newStatus: boolean) {
  const { error } = await supabase
    .from('meta_ad_accounts')
    .update({ is_selected: newStatus })
    // No .eq means update all rows. 
    // Supabase JS requires a filter for mass update unless configured otherwise, 
    // but .neq('id', 'null-uuid') or simply not filtering might work. 
    // Actually, .neq('is_selected', newStatus) is the safest filter.
    .neq('is_selected', newStatus);

  if (error) {
    throw new Error(error.message);
  }
}
