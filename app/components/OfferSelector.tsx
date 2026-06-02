'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Tag, ChevronDown } from 'lucide-react';

/**
 * Dropdown de Oferta que escreve `?oferta=<id>` na URL (ou remove p/ "Todas").
 * Server components leem o param e escopam suas queries.
 */
export default function OfferSelector({
  offers,
  current,
}: {
  offers: { id: number; nome: string }[];
  current: number | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const onChange = (val: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (val === '') params.delete('oferta');
    else params.set('oferta', val);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <div className="relative inline-flex items-center">
      <Tag className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 pointer-events-none" />
      <select
        value={current == null ? '' : String(current)}
        onChange={e => onChange(e.target.value)}
        className="appearance-none pl-8 pr-8 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-700 shadow-sm hover:border-gray-300 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100 cursor-pointer"
      >
        <option value="">Todas as ofertas</option>
        {offers.map(o => (
          <option key={o.id} value={o.id}>{o.nome}</option>
        ))}
      </select>
      <ChevronDown className="w-3.5 h-3.5 text-gray-400 absolute right-2.5 pointer-events-none" />
    </div>
  );
}
