import { NextResponse } from 'next/server';
import { getCatalogsFromDB } from '@/lib/meta-catalogs';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const groups = await getCatalogsFromDB();
    return NextResponse.json({ success: true, groups });
  } catch (error: any) {
    console.error('GET /api/catalogs error:', error);
    return NextResponse.json(
      { success: false, error: error?.message ?? String(error) },
      { status: 500 }
    );
  }
}
