import { NextResponse } from 'next/server';
import { listBmsForCatalogCreation } from '@/lib/meta-catalogs';

export const dynamic = 'force-dynamic';

// GET /api/catalogs/bms — BMs disponíveis para criar catálogo (dropdown global).
export async function GET() {
  try {
    const bms = await listBmsForCatalogCreation();
    return NextResponse.json({ success: true, bms });
  } catch (error: any) {
    console.error('GET /api/catalogs/bms error:', error);
    return NextResponse.json(
      { success: false, error: error?.message ?? String(error) },
      { status: 500 }
    );
  }
}
