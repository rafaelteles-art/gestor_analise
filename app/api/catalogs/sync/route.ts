import { NextResponse } from 'next/server';
import { fetchAndSyncMetaCatalogs } from '@/lib/meta-catalogs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST() {
  try {
    const result = await fetchAndSyncMetaCatalogs();
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('POST /api/catalogs/sync error:', error);
    return NextResponse.json(
      { success: false, error: error?.message ?? String(error) },
      { status: 500 }
    );
  }
}
