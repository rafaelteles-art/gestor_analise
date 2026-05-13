import V2MediaLabLayout from '../components/V2MediaLabLayout';
import ClientCatalogo from './ClientCatalogo';
import { getCatalogsFromDB, type BMWithCatalogs } from '@/lib/meta-catalogs';

export const dynamic = 'force-dynamic';

export default async function CatalogoPage() {
  let initialGroups: BMWithCatalogs[] = [];
  try {
    initialGroups = await getCatalogsFromDB();
  } catch (error) {
    console.error('Erro carregando catálogos do banco:', error);
  }

  return (
    <V2MediaLabLayout title="Catálogo Facebook">
      <ClientCatalogo initialGroups={initialGroups} />
    </V2MediaLabLayout>
  );
}
