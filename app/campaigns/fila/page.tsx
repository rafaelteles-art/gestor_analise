import V2MediaLabLayout from '@/app/components/V2MediaLabLayout';
import ClientFila from './ClientFila';

export const dynamic = 'force-dynamic';

export default function FilaPage() {
  return (
    <V2MediaLabLayout title="Fila de campanhas">
      <ClientFila />
    </V2MediaLabLayout>
  );
}
