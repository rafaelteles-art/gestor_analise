'use client';

/**
 * ClientFila — Página de histórico/fila de campanhas (/campaigns/fila).
 *
 * Step 1 — Lista com filtros (perfil, status, intervalo de datas), agrupamento por
 *           broadcast_group_id em uma linha colapsável, colunas: created_at (GMT-3),
 *           perfil, conta, status, contadores, duração. Paginação via before_id.
 *
 * Step 2 — Expand de detalhe: log de eventos por entidade com mensagens de erro,
 *           botão de cancelar (pending/running).
 *
 * Step 3 — Re-enfileirar: POST do payload armazenado para /api/campaigns/create
 *           com reenqueue_of=<jobId>. O servidor SEMPRE recalcula access_token (via
 *           resolveAuth) e recomputa frozen_context — o payload enviado pelo cliente
 *           é apenas o template; campos sensíveis/expiráveis são descartados
 *           server-side. Ver app/api/campaigns/create/route.ts linhas 113-144.
 *
 * Step 4 — Link de nav adicionado em V2MediaLabLayout (ver notas_para_dependentes).
 *
 * Notas sobre filtro de data:
 *   O endpoint GET /api/campaigns/jobs não tem cláusula WHERE para intervalo de
 *   datas (lib/campaign-jobs.ts ListJobsFilters). Enquanto esse suporte não estiver
 *   no servidor, o cliente faz filtragem local — mas, para evitar falsos "nenhum
 *   resultado encontrado", o fetchJobs itera páginas automaticamente até encontrar
 *   resultados dentro do intervalo ou esgotar o cursor. O botão "Carregar mais"
 *   só aparece quando a última página retornou PAGE_SIZE linhas E os dados brutos
 *   ainda existem para paginar, independente de quantas passaram pelo filtro.
 *   TODO(server-date-filter): adicionar date_from/date_to em ListJobsFilters +
 *   route.ts para eliminar a iteração local e suportar grandes históricos.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { fmtDateTime } from '@/lib/timezone';
import type { CampaignJobListRow, CampaignJob } from '@/lib/campaign-jobs';
import type { BatchEvent } from '@/lib/batch-contract';

// ─── Tipos locais ─────────────────────────────────────────────────────────────

type JobStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'done_with_errors'
  | 'error'
  | 'cancelled';

type FilterState = {
  profile: string;
  status: string;
  dateFrom: string;
  dateTo: string;
};

// ─── Helpers de status ────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  pending: 'Aguardando',
  running: 'Executando',
  done: 'Concluído',
  done_with_errors: 'Com erros',
  error: 'Erro',
  cancelled: 'Cancelado',
};

const STATUS_COLORS: Record<string, string> = {
  pending:
    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  running:
    'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  done: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  done_with_errors:
    'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  error: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  cancelled:
    'bg-console-surface-2 text-console-muted',
};

function StatusChip({ status }: { status: string }) {
  const color =
    STATUS_COLORS[status] ??
    'bg-console-surface-2 text-console-muted';
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${color}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function isActive(status: string): boolean {
  return status === 'pending' || status === 'running';
}

function isCancellable(status: string): boolean {
  return status === 'pending' || status === 'running';
}

// ─── Formatação de duração ────────────────────────────────────────────────────

function durationStr(
  _createdAt: string,
  startedAt: string | null,
  finishedAt: string | null
): string {
  if (!startedAt) return '—';
  const from = new Date(startedAt).getTime();
  const to = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const secs = Math.round((to - from) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
}

// ─── Contadores ───────────────────────────────────────────────────────────────

function CountsDisplay({
  counts,
}: {
  counts: { created: number; failed: number; skipped: number; total: number };
}) {
  const { created, failed, skipped, total } = counts;
  if (total === 0 && created === 0 && failed === 0) {
    return <span className="text-console-muted text-xs">—</span>;
  }
  return (
    <span className="text-xs font-mono space-x-1">
      {created > 0 && (
        <span className="text-green-700 dark:text-green-400">{created}✓</span>
      )}
      {failed > 0 && (
        <span className="text-red-600 dark:text-red-400">{failed}✗</span>
      )}
      {skipped > 0 && (
        <span className="text-console-muted">{skipped}↷</span>
      )}
      {total > 0 && (
        <span className="text-console-muted">/{total}</span>
      )}
    </span>
  );
}

// ─── Log de eventos (detalhe) ─────────────────────────────────────────────────

const EVENT_KIND_LABELS: Record<string, string> = {
  created: 'Criado',
  failed: 'Falhou',
  skipped: 'Ignorado',
};

const EVENT_KIND_COLORS: Record<string, string> = {
  created: 'text-green-700 dark:text-green-400',
  failed: 'text-red-600 dark:text-red-400',
  skipped: 'text-console-muted',
};

function EventLog({ events }: { events: BatchEvent[] }) {
  if (!events || events.length === 0) {
    return (
      <p className="text-xs text-console-muted italic">
        Nenhum evento registrado ainda.
      </p>
    );
  }

  return (
    <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
      {events.map((ev, i) => {
        const kindLabel = EVENT_KIND_LABELS[ev.kind] ?? ev.kind;
        const kindColor =
          EVENT_KIND_COLORS[ev.kind] ?? 'text-foreground';

        // Use proper discriminated-union narrowing — no `as any` casts.
        // BatchEvent is discriminated on `kind`; after each branch TypeScript
        // knows the exact member type and all field accesses are type-safe.
        let entitySlug = '—';
        let description = '';
        if (ev.kind === 'created') {
          entitySlug = ev.entity.slice(0, 2);
          description = ev.name;
        } else if (ev.kind === 'failed') {
          entitySlug = ev.entity.slice(0, 2);
          description = `${ev.name} — ${ev.error}`;
        } else {
          // ev.kind === 'skipped'
          description = ev.reason;
        }

        return (
          <div
            key={i}
            className="flex items-start gap-2 text-xs font-mono border-b border-console-border pb-1 last:border-0"
          >
            <span className={`shrink-0 w-14 font-semibold ${kindColor}`}>
              {kindLabel}
            </span>
            <span className="text-console-muted shrink-0 w-8">
              {entitySlug}
            </span>
            <span className="text-foreground break-all">
              {description}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Linha de detalhe (carrega full job ao expandir) ─────────────────────────

// Outcome values returned by the cancel endpoint
type CancelOutcome = 'cancelled' | 'cancel_requested' | 'not_cancellable' | 'not_found';

function JobDetailRow({
  jobId,
  onCancelled,
  onReenqueued,
}: {
  jobId: number;
  onCancelled: (id: number, outcome: CancelOutcome) => void;
  onReenqueued: () => void;
}) {
  const [job, setJob] = useState<CampaignJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelMsg, setCancelMsg] = useState<string | null>(null);
  const [reenqueueing, setReenqueueing] = useState(false);
  const [reenqueueMsg, setReenqueueMsg] = useState<string | null>(null);

  // fetchJob re-loads the detail row from the server (used after 409 to show
  // the real terminal status rather than a stale cancellable view).
  const fetchJob = useCallback(async () => {
    try {
      const r = await fetch(`/api/campaigns/jobs/${jobId}`);
      if (!r.ok) return;
      const data = await r.json();
      setJob(data.job);
    } catch {
      // Ignore — the user can collapse/expand to retry.
    }
  }, [jobId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/campaigns/jobs/${jobId}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!cancelled) setJob(data.job);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const handleCancel = async () => {
    if (!job) return;
    setCancelling(true);
    setCancelMsg(null);
    try {
      const res = await fetch(`/api/campaigns/jobs/${jobId}/cancel`, {
        method: 'POST',
      });

      // HTTP 409 means the job is already terminal (done/error/cancelled/done_with_errors).
      // Do NOT propagate to parent as a cancellation — instead refresh this detail
      // row so both the expanded view and the parent list show the real status.
      if (res.status === 409) {
        const data = await res.json().catch(() => ({ outcome: 'not_cancellable' }));
        const outcome: CancelOutcome = data?.outcome ?? 'not_cancellable';
        setCancelMsg('Job já finalizado — atualizando status.');
        // Refresh the detail row to reflect the real terminal status.
        await fetchJob();
        // Notify the parent so the list row also reflects the real outcome
        // (the parent will re-fetch or leave the row as-is per outcome).
        onCancelled(jobId, outcome);
        return;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const outcome: CancelOutcome = data?.outcome ?? 'cancelled';

      // Update local detail state to match outcome:
      // - 'cancelled': status flips immediately.
      // - 'cancel_requested': status stays 'running', cancel_requested flag set.
      setJob((prev) =>
        prev
          ? {
              ...prev,
              status: outcome === 'cancelled' ? 'cancelled' : prev.status,
              cancel_requested:
                outcome === 'cancel_requested' ? true : prev.cancel_requested,
            }
          : prev
      );

      // Propagate to parent with the actual outcome so the list row updates correctly.
      onCancelled(jobId, outcome);
    } catch (e: any) {
      alert(`Erro ao cancelar: ${e.message}`);
    } finally {
      setCancelling(false);
    }
  };

  const handleReenqueue = async () => {
    if (!job) return;
    setReenqueueing(true);
    setReenqueueMsg(null);
    try {
      // Envia o payload original como template junto com reenqueue_of=<id>.
      // O servidor (/api/campaigns/create) SEMPRE descarta o access_token e o
      // frozen_context vindos do cliente e os recomputa — resolveAuth obtém um
      // token fresco do DB e frozenDateParts captura o instante atual em GMT-3.
      // Tokens expirados no payload armazenado são portanto inócuos.
      // Ref: app/api/campaigns/create/route.ts linhas 113-144.
      const res = await fetch('/api/campaigns/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...job.payload,
          reenqueue_of: job.id,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      const count = data?.jobs?.length ?? 1;
      setReenqueueMsg(
        `Re-enfileirado com sucesso (${count} job${count !== 1 ? 's' : ''}).`
      );
      onReenqueued();
    } catch (e: any) {
      setReenqueueMsg(`Erro: ${e.message}`);
    } finally {
      setReenqueueing(false);
    }
  };

  if (loading) {
    return (
      <div className="py-4 px-6 text-sm text-console-muted animate-pulse">
        Carregando detalhes…
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-4 px-6 text-sm text-red-600 dark:text-red-400">
        Erro ao carregar: {error}
      </div>
    );
  }

  if (!job) return null;

  const cancellable = isCancellable(job.status);
  const provenance = job.payload?.reenqueue_of;

  return (
    <div className="bg-console-surface-2 px-6 py-4 border-b border-console-border">
      {/* Proveniência */}
      {provenance && (
        <p className="text-xs text-console-muted mb-3">
          Re-enfileirado a partir do job{' '}
          <span className="font-mono font-semibold">#{provenance}</span>
        </p>
      )}

      {/* Erro de job */}
      {job.error && (
        <div className="mb-3 p-2 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300 font-mono break-all">
          {job.error}
        </div>
      )}

      {/* Log de eventos */}
      <div className="mb-4">
        <p className="text-xs font-semibold text-console-muted uppercase tracking-wider mb-2">
          Eventos ({job.events?.length ?? 0})
        </p>
        <EventLog events={job.events ?? []} />
      </div>

      {/* Ações */}
      <div className="flex items-center gap-3 flex-wrap">
        {cancellable && (
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-700 hover:bg-red-100 dark:hover:bg-red-900/50 disabled:opacity-50 transition-colors"
          >
            {cancelling ? 'Cancelando…' : 'Cancelar job'}
          </button>
        )}

        {cancelMsg && (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            {cancelMsg}
          </span>
        )}

        <button
          onClick={handleReenqueue}
          disabled={reenqueueing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 disabled:opacity-50 transition-colors"
        >
          {reenqueueing ? 'Re-enfileirando…' : 'Re-enfileirar'}
        </button>

        {reenqueueMsg && (
          <span
            className={`text-xs ${reenqueueMsg.startsWith('Erro') ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}
          >
            {reenqueueMsg}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Linha de broadcast group ─────────────────────────────────────────────────

function BroadcastGroupRow({
  groupId,
  jobs,
  expandedJobs,
  toggleExpand,
  onCancelled,
  onReenqueued,
}: {
  groupId: string;
  jobs: CampaignJobListRow[];
  expandedJobs: Set<number>;
  toggleExpand: (id: number) => void;
  onCancelled: (id: number, outcome: CancelOutcome) => void;
  onReenqueued: () => void;
}) {
  // Aggregate status: prefer worst status for group header
  const statusPriority: Record<string, number> = {
    error: 0,
    done_with_errors: 1,
    cancelled: 2,
    running: 3,
    pending: 4,
    done: 5,
  };
  const aggregateStatus = jobs.reduce((worst, j) => {
    const wp = statusPriority[worst] ?? 99;
    const jp = statusPriority[j.status] ?? 99;
    return jp < wp ? j.status : worst;
  }, jobs[0]?.status ?? 'pending');

  const totalCounts = jobs.reduce(
    (acc, j) => ({
      created: acc.created + (j.counts?.created ?? 0),
      failed: acc.failed + (j.counts?.failed ?? 0),
      skipped: acc.skipped + (j.counts?.skipped ?? 0),
      total: acc.total + (j.counts?.total ?? 0),
    }),
    { created: 0, failed: 0, skipped: 0, total: 0 }
  );

  const firstJob = jobs[0];
  const [collapsed, setCollapsed] = useState(jobs.length > 1);

  // Short group id label (last 8 chars of UUID)
  const shortGroupId = groupId.slice(-8);

  return (
    <>
      {/* Cabeçalho do grupo (só mostra se houver mais de 1 job) */}
      {jobs.length > 1 && (
        <tr
          className="bg-amber-500/10 cursor-pointer hover:bg-amber-500/15 transition-colors"
          onClick={() => setCollapsed((c) => !c)}
        >
          <td className="px-4 py-2" colSpan={7}>
            <div className="flex items-center gap-2 text-xs text-amber-400 font-semibold">
              <span className="text-amber-500/60">
                {collapsed ? '▶' : '▼'}
              </span>
              <span>Broadcast</span>
              <span className="font-mono text-amber-500/60">
                #{shortGroupId}
              </span>
              <span className="text-amber-500/60">
                — {jobs.length} contas
              </span>
              <StatusChip status={aggregateStatus} />
              <span className="ml-auto">
                <CountsDisplay counts={totalCounts} />
              </span>
            </div>
          </td>
        </tr>
      )}

      {/* Linhas individuais */}
      {(!collapsed || jobs.length === 1) &&
        jobs.map((job) => (
          <JobRow
            key={job.id}
            job={job}
            expanded={expandedJobs.has(job.id)}
            onToggle={() => toggleExpand(job.id)}
            onCancelled={onCancelled}
            onReenqueued={onReenqueued}
            indent={jobs.length > 1}
          />
        ))}
    </>
  );
}

// ─── Linha individual de job ──────────────────────────────────────────────────

function JobRow({
  job,
  expanded,
  onToggle,
  onCancelled,
  onReenqueued,
  indent,
}: {
  job: CampaignJobListRow;
  expanded: boolean;
  onToggle: () => void;
  onCancelled: (id: number, outcome: CancelOutcome) => void;
  onReenqueued: () => void;
  indent: boolean;
}) {
  const displayName = job.account_name ?? job.account_id;
  const activeRow = isActive(job.status);

  return (
    <>
      <tr
        className={`border-b border-console-border border-l-2 border-l-transparent hover:border-l-amber-500 cursor-pointer transition-colors ${
          expanded
            ? 'bg-amber-500/10'
            : activeRow
            ? 'bg-blue-50/40 dark:bg-blue-950/10 hover:bg-blue-50 dark:hover:bg-blue-950/20'
            : 'bg-console-surface hover:bg-console-surface-2'
        }`}
        onClick={onToggle}
      >
        {/* ID + expand chevron */}
        <td className="px-4 py-3 whitespace-nowrap">
          <div className="flex items-center gap-2">
            {indent && (
              <span className="w-3 shrink-0 text-console-muted text-xs select-none">
                └
              </span>
            )}
            <span className="text-xs text-console-muted font-mono">
              #{job.id}
            </span>
            <span className="text-console-muted text-xs">
              {expanded ? '▾' : '▸'}
            </span>
          </div>
        </td>

        {/* Data de criação (GMT-3) */}
        <td className="px-4 py-3 whitespace-nowrap text-xs text-foreground">
          {fmtDateTime(job.created_at, {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </td>

        {/* Perfil */}
        <td className="px-4 py-3 whitespace-nowrap">
          <span className="text-xs font-medium text-foreground">
            {job.profile_name}
          </span>
        </td>

        {/* Conta */}
        <td className="px-4 py-3">
          <span className="text-xs text-foreground break-all">
            {displayName}
          </span>
        </td>

        {/* Status */}
        <td className="px-4 py-3 whitespace-nowrap">
          <StatusChip status={job.status} />
          {job.cancel_requested && job.status === 'running' && (
            <span className="ml-1 text-[10px] text-orange-500 dark:text-orange-400">
              (cancelando…)
            </span>
          )}
        </td>

        {/* Contadores */}
        <td className="px-4 py-3 whitespace-nowrap">
          <CountsDisplay counts={job.counts ?? { created: 0, failed: 0, skipped: 0, total: 0 }} />
        </td>

        {/* Duração */}
        <td className="px-4 py-3 whitespace-nowrap text-xs text-console-muted font-mono">
          {durationStr(job.created_at, job.started_at, job.finished_at)}
        </td>
      </tr>

      {/* Painel de detalhe inline */}
      {expanded && (
        <tr>
          <td colSpan={7} className="p-0">
            <JobDetailRow
              jobId={job.id}
              onCancelled={onCancelled}
              onReenqueued={onReenqueued}
            />
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Helpers de filtro de data (client-side) ──────────────────────────────────

/**
 * Filtra jobs pelo intervalo de datas em GMT-3.
 * Usado enquanto o servidor não suporta date_from/date_to.
 */
function applyDateFilter(
  jobs: CampaignJobListRow[],
  dateFrom: string,
  dateTo: string
): CampaignJobListRow[] {
  if (!dateFrom && !dateTo) return jobs;
  return jobs.filter((j) => {
    const jd = new Date(j.created_at);
    if (dateFrom && jd < new Date(dateFrom + 'T00:00:00-03:00')) return false;
    if (dateTo && jd > new Date(dateTo + 'T23:59:59-03:00')) return false;
    return true;
  });
}

// ─── Componente principal ─────────────────────────────────────────────────────

const ALL_STATUSES: JobStatus[] = [
  'pending',
  'running',
  'done',
  'done_with_errors',
  'error',
  'cancelled',
];

const PAGE_SIZE = 40;

export default function ClientFila() {
  const [jobs, setJobs] = useState<CampaignJobListRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // hasMore tracks whether the raw API has more pages (independent of date filter).
  const [hasMore, setHasMore] = useState(false);
  const [expandedJobs, setExpandedJobs] = useState<Set<number>>(new Set());
  const [profiles, setProfiles] = useState<string[]>([]);

  // Filtros
  const [filters, setFilters] = useState<FilterState>({
    profile: '',
    status: '',
    dateFrom: '',
    dateTo: '',
  });

  // Keyset cursor: id of the oldest job in the currently-loaded set.
  const beforeIdRef = useRef<number | undefined>(undefined);

  // ─── Fetch ──────────────────────────────────────────────────────────────────

  /**
   * Fetches one page from the API (status/profile filters server-side) and
   * applies the date filter client-side.
   *
   * When `reset=true`: replaces the current list (reset to page 1).
   * When `reset=false`: appends to the current list (load-more).
   *
   * Because the API has no server-side date filter, a single 40-row page may be
   * entirely outside the selected date window. To avoid a false empty-state on
   * the first load, this function will keep fetching pages (following the cursor)
   * until it accumulates at least one visible row OR the API reports no more
   * pages. The "Carregar mais" button uses the raw API hasMore so users can
   * always continue paginating even if visible rows per page are sparse.
   */
  const fetchJobs = useCallback(
    async (reset: boolean) => {
      setLoading(true);
      setError(null);
      try {
        // When resetting, use a fresh cursor; otherwise continue from saved cursor.
        let currentCursor: number | undefined = reset ? undefined : beforeIdRef.current;
        let accumulated: CampaignJobListRow[] = [];
        let rawHasMore = false;

        // Keep fetching until we have ≥1 visible row (after date filter) OR API
        // has no more pages. This prevents a false "Nenhum job encontrado" when
        // the date filter excludes all rows in the first page(s).
        // Cap at 5 auto-pages to avoid runaway requests on very sparse histories.
        const MAX_AUTO_PAGES = 5;
        let autoPageCount = 0;

        do {
          const params = new URLSearchParams();
          if (filters.profile) params.set('profile', filters.profile);
          if (filters.status) params.set('status', filters.status);
          params.set('limit', String(PAGE_SIZE));
          if (currentCursor !== undefined) {
            params.set('before_id', String(currentCursor));
          }

          const res = await fetch(`/api/campaigns/jobs?${params.toString()}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          const fetched: CampaignJobListRow[] = data.jobs ?? [];

          rawHasMore = fetched.length === PAGE_SIZE;

          // Advance cursor for next iteration / next explicit load-more
          if (fetched.length > 0) {
            currentCursor = fetched[fetched.length - 1].id;
          }

          // Collect unique profiles for dropdown
          const newProfiles = fetched
            .map((j) => j.profile_name)
            .filter((p): p is string => Boolean(p));
          if (newProfiles.length > 0) {
            setProfiles((prev) => Array.from(new Set([...prev, ...newProfiles])));
          }

          accumulated = accumulated.concat(fetched);
          autoPageCount++;

          // Stop auto-paging if: API has no more data, or we have visible rows after filter
          const visibleSoFar = applyDateFilter(accumulated, filters.dateFrom, filters.dateTo);
          if (!rawHasMore || visibleSoFar.length > 0) break;
        } while (autoPageCount < MAX_AUTO_PAGES);

        // Persist cursor for future load-more / refresh
        beforeIdRef.current = currentCursor;

        const visible = applyDateFilter(accumulated, filters.dateFrom, filters.dateTo);

        setJobs((prev) => (reset ? visible : [...prev, ...visible]));
        // hasMore reflects whether the raw API has more data to page through —
        // independent of the date filter so the button never disappears prematurely.
        setHasMore(rawHasMore);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    },
    [filters]
  );

  // Reload ao mudar filtros
  useEffect(() => {
    beforeIdRef.current = undefined;
    setExpandedJobs(new Set());
    fetchJobs(true);
  }, [fetchJobs]);

  // ─── Auto-refresh ────────────────────────────────────────────────────────────
  //
  // When jobs are active (pending/running), poll every 5s to reflect progress.
  // To preserve pagination state, we do NOT reset the cursor. Instead we fetch
  // only the set of ids that are currently visible (by re-fetching rows newer
  // than or equal to the oldest loaded id), then merge updated rows in-place.
  // This means a user who paged deep keeps their rows; only status/counts/etc.
  // update on active jobs. New jobs that arrived after the initial load will
  // appear on the next manual refresh or filter change.
  useEffect(() => {
    const hasActive = jobs.some((j) => isActive(j.status));
    if (!hasActive) return;

    const id = setInterval(async () => {
      // Fetch a fresh view of jobs in the currently-visible id range.
      // We use the oldest loaded id as a lower bound (jobs with id >= oldest).
      if (jobs.length === 0) return;

      // Build a cursor-less fetch to get the newest PAGE_SIZE rows (same params),
      // apply the same date filter, then merge by id (replace matching, keep rest).
      // For deep lists (>PAGE_SIZE rows loaded), rows older than the window won't
      // be refreshed by auto-tick — that is acceptable because active jobs are
      // always recent and will appear in the newest page.
      try {
        const params = new URLSearchParams();
        if (filters.profile) params.set('profile', filters.profile);
        if (filters.status) params.set('status', filters.status);
        params.set('limit', String(PAGE_SIZE));

        const res = await fetch(`/api/campaigns/jobs?${params.toString()}`);
        if (!res.ok) return; // silent — next tick will retry
        const data = await res.json();
        const fetched: CampaignJobListRow[] = data.jobs ?? [];
        const freshVisible = applyDateFilter(fetched, filters.dateFrom, filters.dateTo);

        // Build a lookup map of refreshed rows
        const freshById = new Map(freshVisible.map((j) => [j.id, j]));

        // Merge: update in-place rows that appear in the fresh page; leave the
        // rest unchanged so deeper pages are preserved.
        setJobs((prev) => prev.map((j) => freshById.get(j.id) ?? j));
      } catch {
        // Ignore transient errors on background refresh — next tick will retry.
      }
    }, 5000);

    return () => clearInterval(id);
  }, [jobs, filters]);

  // ─── Ações ───────────────────────────────────────────────────────────────────

  const toggleExpand = useCallback((id: number) => {
    setExpandedJobs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleCancelled = useCallback((id: number, outcome: CancelOutcome) => {
    setJobs((prev) =>
      prev.map((j) => {
        if (j.id !== id) return j;
        // 'cancelled': job confirmed cancelled — flip status immediately.
        if (outcome === 'cancelled') return { ...j, status: 'cancelled' as const };
        // 'cancel_requested': worker will stop at the next entity; keep status
        // 'running' so polling continues and the row updates to its real terminal
        // status when the worker finishes.
        if (outcome === 'cancel_requested') return { ...j, cancel_requested: true };
        // 'not_cancellable' (409) or 'not_found': the server already has the real
        // status; do NOT overwrite — the next auto-refresh tick will reconcile.
        return j;
      })
    );
  }, []);

  const handleReenqueued = useCallback(() => {
    // Recarrega a lista do início para mostrar o novo job
    beforeIdRef.current = undefined;
    setExpandedJobs(new Set());
    fetchJobs(true);
  }, [fetchJobs]);

  const handleLoadMore = () => {
    fetchJobs(false);
  };

  const handleFilterChange = (key: keyof FilterState, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  // ─── Agrupamento por broadcast_group_id ──────────────────────────────────────

  // Mantém a ordem de chegada dos grupos (mais recente primeiro)
  const groups: Map<string, CampaignJobListRow[]> = new Map();
  for (const job of jobs) {
    const gid = job.broadcast_group_id ?? `solo:${job.id}`;
    if (!groups.has(gid)) groups.set(gid, []);
    groups.get(gid)!.push(job);
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 max-w-7xl">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">
            Fila de campanhas
          </h1>
          <p className="text-sm text-console-muted mt-0.5">
            Histórico de jobs de criação — mais recentes primeiro
          </p>
        </div>
        <button
          onClick={() => {
            beforeIdRef.current = undefined;
            setExpandedJobs(new Set());
            fetchJobs(true);
          }}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded text-sm font-semibold bg-console-surface border border-console-border text-foreground hover:bg-console-surface-2 disabled:opacity-50 transition-colors"
        >
          <svg
            className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Atualizar
        </button>
      </div>

      {/* Filtros */}
      <div className="bg-console-surface border border-console-border rounded p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Perfil */}
          <div>
            <label className="block text-xs font-semibold text-console-muted uppercase tracking-wider mb-1">
              Perfil
            </label>
            <select
              value={filters.profile}
              onChange={(e) => handleFilterChange('profile', e.target.value)}
              className="w-full rounded border border-console-border bg-background text-foreground text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="">Todos os perfis</option>
              {profiles.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          {/* Status */}
          <div>
            <label className="block text-xs font-semibold text-console-muted uppercase tracking-wider mb-1">
              Status
            </label>
            <select
              value={filters.status}
              onChange={(e) => handleFilterChange('status', e.target.value)}
              className="w-full rounded border border-console-border bg-background text-foreground text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="">Todos os status</option>
              {ALL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>

          {/* Data início */}
          <div>
            <label className="block text-xs font-semibold text-console-muted uppercase tracking-wider mb-1">
              De
            </label>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
              className="w-full rounded border border-console-border bg-background text-foreground text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          {/* Data fim */}
          <div>
            <label className="block text-xs font-semibold text-console-muted uppercase tracking-wider mb-1">
              Até
            </label>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => handleFilterChange('dateTo', e.target.value)}
              className="w-full rounded border border-console-border bg-background text-foreground text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
        </div>

        {/* Chips de status rápido */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <span className="text-xs text-console-muted">
            Filtro rápido:
          </span>
          <button
            onClick={() => handleFilterChange('status', '')}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
              filters.status === ''
                ? 'bg-amber-500 text-white'
                : 'bg-console-surface-2 text-console-muted hover:bg-console-surface-2'
            }`}
          >
            Todos
          </button>
          {['pending', 'running', 'done', 'done_with_errors', 'error', 'cancelled'].map(
            (s) => (
              <button
                key={s}
                onClick={() =>
                  handleFilterChange('status', filters.status === s ? '' : s)
                }
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  filters.status === s
                    ? 'bg-amber-500 text-white'
                    : 'bg-console-surface-2 text-console-muted hover:bg-console-surface-2'
                }`}
              >
                {STATUS_LABELS[s]}
              </button>
            )
          )}
        </div>

        {/* Aviso de filtro de data (client-side) */}
        {(filters.dateFrom || filters.dateTo) && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            Filtro de data aplicado localmente — use "Carregar mais" para
            buscar registros mais antigos fora da janela visível.
          </p>
        )}
      </div>

      {/* Erro */}
      {error && (
        <div className="p-4 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
          Erro ao carregar jobs: {error}
        </div>
      )}

      {/* Tabela */}
      <div className="bg-console-surface border border-console-border rounded overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-console-surface-2 border-b border-console-border">
                <th className="px-4 py-3 text-left text-xs font-semibold text-console-muted uppercase tracking-wider whitespace-nowrap">
                  Job
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-console-muted uppercase tracking-wider whitespace-nowrap">
                  Criado (GMT-3)
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-console-muted uppercase tracking-wider whitespace-nowrap">
                  Perfil
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-console-muted uppercase tracking-wider whitespace-nowrap">
                  Conta
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-console-muted uppercase tracking-wider whitespace-nowrap">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-console-muted uppercase tracking-wider whitespace-nowrap">
                  Entidades
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-console-muted uppercase tracking-wider whitespace-nowrap">
                  Duração
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && jobs.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-12 text-center text-sm text-console-muted"
                  >
                    <span className="animate-pulse">Carregando…</span>
                  </td>
                </tr>
              ) : groups.size === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-12 text-center text-sm text-console-muted"
                  >
                    Nenhum job encontrado para os filtros selecionados.
                    {(filters.dateFrom || filters.dateTo) && hasMore && (
                      <span className="block mt-1 text-xs text-amber-600 dark:text-amber-400">
                        Há mais registros — clique "Carregar mais" para
                        continuar buscando no período selecionado.
                      </span>
                    )}
                  </td>
                </tr>
              ) : (
                Array.from(groups.entries()).map(([gid, groupJobs]) => (
                  <BroadcastGroupRow
                    key={gid}
                    groupId={gid}
                    jobs={groupJobs}
                    expandedJobs={expandedJobs}
                    toggleExpand={toggleExpand}
                    onCancelled={handleCancelled}
                    onReenqueued={handleReenqueued}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Rodapé: paginação */}
        {(hasMore || loading) && (
          <div className="px-4 py-3 border-t border-console-border flex justify-center">
            <button
              onClick={handleLoadMore}
              disabled={loading}
              className="px-4 py-2 rounded text-sm font-medium bg-console-surface-2 text-foreground hover:bg-console-surface-2 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Carregando…' : 'Carregar mais'}
            </button>
          </div>
        )}
      </div>

      {/* Legenda */}
      <p className="text-xs text-console-muted">
        ✓ criado · ✗ falhou · ↷ ignorado (ancestral falhou) · Clique em uma
        linha para ver detalhes e ações.
      </p>
    </div>
  );
}
