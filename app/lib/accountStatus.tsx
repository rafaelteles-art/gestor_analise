import React from 'react';

// ─── Account Status Badge ─────────────────────────────────────────────────────
// Shared across the status-contas page and the Import/ImportV2 dashboards so the
// Meta ad-account status (account_status) renders with consistent labels/colors.
// Color/label map mirrors status-contas/ClientStatusContas.tsx.

export const ACCOUNT_STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  'ACTIVE':                   { label: 'Ativo',           cls: 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400' },
  'DISABLED':                 { label: 'Desabilitado',    cls: 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400' },
  'UNSETTLED':                { label: 'Inadimplente',    cls: 'bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400' },
  'PENDING_REVIEW':           { label: 'Em Revisão',      cls: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-400' },
  'PENDING_CLOSURE':          { label: 'Encerrando',      cls: 'bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400' },
  'IN_GRACE_PERIOD':          { label: 'Carência',        cls: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400' },
  'TEMPORARILY_UNAVAILABLE':  { label: 'Indisponível',    cls: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' },
  'CLOSED':                   { label: 'Encerrada',       cls: 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500' },
  'UNKNOWN':                  { label: 'Desconhecido',    cls: 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500' },
};

export function AccountStatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  const cfg = ACCOUNT_STATUS_LABEL[status] ?? { label: status, cls: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}
