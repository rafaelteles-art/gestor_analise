import { NextResponse } from 'next/server';
import { fetchAndSyncMetaAccounts } from '@/lib/meta-accounts';
import { fetchAndSyncRedTrackCampaigns } from '@/lib/redtrack-campaigns';

export async function GET() {
  try {
    const metaResult = await fetchAndSyncMetaAccounts();
    const rtResult = await fetchAndSyncRedTrackCampaigns();
    
    return NextResponse.json({
      success: true,
      message: `Scaneado com sucesso. Encontradas ${metaResult.count} contas Meta e ${rtResult.count} campanhas RedTrack.`,
      data: {
        meta: metaResult.accounts,
        redtrack: rtResult.campaigns
      }
    });
  } catch (error: any) {
    console.error("Critical Accounts Sync Error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
