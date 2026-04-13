import { NextResponse } from 'next/server';
import { fetchAndSyncMetaAccounts } from '@/lib/meta-accounts';
import { fetchAndSyncRedTrackCampaigns } from '@/lib/redtrack-campaigns';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    console.log('[accounts/sync] Starting Meta accounts sync...');
    const metaResult = await fetchAndSyncMetaAccounts();
    console.log(`[accounts/sync] Meta done: ${metaResult.count} accounts`);

    console.log('[accounts/sync] Starting RedTrack sync...');
    const rtResult = await fetchAndSyncRedTrackCampaigns();
    console.log(`[accounts/sync] RedTrack done: ${rtResult.count} campaigns`);

    return NextResponse.json({
      success: true,
      message: `Scaneado com sucesso. Encontradas ${metaResult.count} contas Meta e ${rtResult.count} campanhas RedTrack.`,
      data: {
        meta: metaResult.accounts,
        redtrack: rtResult.campaigns
      }
    });
  } catch (error: any) {
    console.error('[accounts/sync] Error:', error?.message, error?.stack);
    return NextResponse.json(
      { success: false, error: error?.message ?? String(error) },
      { status: 500 }
    );
  }
}
