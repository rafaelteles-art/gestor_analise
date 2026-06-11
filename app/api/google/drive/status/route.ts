import { NextRequest, NextResponse } from 'next/server';
import {
  getGoogleDriveOAuth,
  deleteGoogleDriveOAuth,
  invalidateAccessTokenCache,
} from '@/lib/google-drive';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/google/drive/status
 * Returns { connected: boolean, email?: string }
 */
export async function GET() {
  try {
    const record = await getGoogleDriveOAuth();
    if (!record?.refresh_token) {
      return NextResponse.json({ connected: false });
    }
    return NextResponse.json({ connected: true, email: record.email || undefined });
  } catch (err: any) {
    console.error('GET /api/google/drive/status error:', err);
    return NextResponse.json({ connected: false });
  }
}

/**
 * DELETE /api/google/drive/status
 * Removes the stored OAuth credential (disconnect).
 * Returns { success: true }
 */
export async function DELETE(_req: NextRequest) {
  try {
    await deleteGoogleDriveOAuth();
    invalidateAccessTokenCache();
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('DELETE /api/google/drive/status error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
