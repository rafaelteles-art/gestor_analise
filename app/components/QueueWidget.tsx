'use client';

// QueueWidget — compact live card of active campaign jobs (Task B1b, Step 2).
//
// Rendered by the builder right after an enqueue (202). It polls
// GET /api/campaigns/jobs?active=1 while mounted and while any pinned job is
// still pending/running, groups rows by Profile, and shows a status chip,
// created/total progress, the last event line, a cancel button and a link to
// the dedicated /campaigns/fila history page.
//
// Self-contained: the only input is the set of job ids to pin (returned by the
// create route). It does not own the tick/poll loop that re-kicks the worker —
// the builder owns that so a single timer drives both the kick and this widget.
// Instead the widget accepts the already-fetched `jobs` array OR fetches on its
// own when `jobs` is not supplied. To keep the builder as the single source of
// polling truth we drive it via the `jobs` prop.

import { useEffect, useRef, useState } from 'react';

// Mirror of lib/campaign-jobs.ts CampaignJobListRow (client can't import server lib).
type BatchEvent =
  | { kind: 'created'; key: string; entity: 'campaign' | 'adset' | 'ad'; name: string; id: string }
  | { kind: 'failed'; key: string; entity: 'campaign' | 'adset' | 'ad'; name: string; error: string; permanent: boolean }
  | { kind: 'skipped'; key: string; reason: string };

export interface QueueJobRow {
  id: number;
  status: 'pending' | 'running' | 'done' | 'done_with_errors' | 'error' | 'cancelled';
  profile_name: string;
  account_id: string;
  account_name: string | null;
  broadcast_group_id: string | null;
  events: BatchEvent[];
  counts: { created: number; failed: number; skipped: number; total: number };
  error: string | null;
  cancel_requested: boolean;
  created_at: string;
  finished_at: string | null;
}

const ACTIVE_STATUSES = new Set(['pending', 'running']);

function statusChip(status: QueueJobRow['status'], cancelRequested: boolean) {
  if (cancelRequested && status === 'running') {
    return { label: 'cancelando…', cls: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800' };
  }
  switch (status) {
    case 'pending':
      return { label: 'na fila', cls: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700' };
    case 'running':
      return { label: 'rodando', cls: 'bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800' };
    case 'done':
      return { label: 'concluído', cls: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800' };
    case 'done_with_errors':
      return { label: 'concluído c/ erros', cls: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800' };
    case 'error':
      return { label: 'erro', cls: 'bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800' };
    case 'cancelled':
      return { label: 'cancelado', cls: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700' };
    default:
      return { label: status, cls: 'bg-gray-100 dark:bg-gray-800 text-gray-600 border-gray-200' };
  }
}

function lastEventLine(job: QueueJobRow): string {
  if (job.error) return `✗ ${job.error}`;
  const ev = job.events[job.events.length - 1];
  if (!ev) {
    return job.status === 'pending' ? 'aguardando início…' : 'iniciando…';
  }
  if (ev.kind === 'created') return `✓ ${ev.entity}: ${ev.name}`;
  if (ev.kind === 'failed') return `✗ ${ev.entity}: ${ev.name} — ${ev.error}`;
  return `↷ pulado: ${ev.reason}`;
}

function acctLabel(job: QueueJobRow): string {
  return job.account_name || job.account_id;
}

export function QueueWidget({
  jobs,
  onClose,
}: {
  jobs: QueueJobRow[];
  onClose?: () => void;
}) {
  const [cancelling, setCancelling] = useState<Set<number>>(new Set());

  const cancel = async (id: number) => {
    setCancelling(prev => new Set(prev).add(id));
    try {
      await fetch(`/api/campaigns/jobs/${id}/cancel`, { method: 'POST' });
    } catch {
      // Swallow — the next poll reflects the real state. Re-enable the button.
      setCancelling(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  if (jobs.length === 0) return null;

  // Group by Profile, preserving first-seen order.
  const groups: { profile: string; rows: QueueJobRow[] }[] = [];
  const byProfile = new Map<string, QueueJobRow[]>();
  for (const j of jobs) {
    const arr = byProfile.get(j.profile_name);
    if (arr) {
      arr.push(j);
    } else {
      const fresh = [j];
      byProfile.set(j.profile_name, fresh);
      groups.push({ profile: j.profile_name, rows: fresh });
    }
  }

  const anyActive = jobs.some(j => ACTIVE_STATUSES.has(j.status));

  return (
    <div className="border border-indigo-200 dark:border-indigo-800 rounded-xl bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
      <header className="px-4 py-2.5 bg-indigo-50 dark:bg-indigo-950/40 border-b border-indigo-200 dark:border-indigo-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm">📋</span>
          <span className="text-[12px] font-bold text-indigo-800 dark:text-indigo-300">
            Fila de criação{anyActive ? ' — em andamento' : ''}
          </span>
          <span className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 bg-white dark:bg-gray-900 border border-indigo-200 dark:border-indigo-800 rounded-full px-2 py-0.5">
            {jobs.length} job{jobs.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/campaigns/fila"
            className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-400 underline hover:text-indigo-900 dark:hover:text-indigo-300"
          >
            ver fila completa →
          </a>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="text-indigo-400 dark:text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300 text-lg leading-none w-5 h-5 flex items-center justify-center"
              aria-label="Fechar"
              title="Ocultar (os jobs continuam rodando em segundo plano)"
            >
              ×
            </button>
          )}
        </div>
      </header>

      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {groups.map(({ profile, rows }) => (
          <div key={profile} className="px-4 py-2">
            <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1.5">
              {profile}
            </p>
            <div className="flex flex-col gap-2">
              {rows.map(job => {
                const chip = statusChip(job.status, job.cancel_requested);
                const total = job.counts.total || 0;
                const created = job.counts.created || 0;
                const pct = total > 0 ? Math.min(100, Math.round((created / total) * 100)) : 0;
                const isActive = ACTIVE_STATUSES.has(job.status);
                const canCancel = isActive && !job.cancel_requested;
                return (
                  <div key={job.id} className="rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/40 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-gray-800 dark:text-gray-100 truncate flex-1">
                        {acctLabel(job)}
                        <span className="text-gray-400 dark:text-gray-500 font-mono font-normal"> ({job.account_id})</span>
                      </span>
                      <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${chip.cls}`}>
                        {chip.label}
                      </span>
                    </div>

                    {/* progress */}
                    <div className="flex items-center gap-2 mt-1.5">
                      <div className="flex-1 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${job.counts.failed > 0 ? 'bg-amber-500' : 'bg-indigo-500'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-gray-500 dark:text-gray-400 font-mono shrink-0 tabular-nums">
                        {created}/{total || '?'}
                        {job.counts.failed > 0 && (
                          <span className="text-rose-600 dark:text-rose-400"> · {job.counts.failed}✗</span>
                        )}
                      </span>
                    </div>

                    {/* last event */}
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 truncate" title={lastEventLine(job)}>
                      {lastEventLine(job)}
                    </p>

                    {canCancel && (
                      <div className="mt-1.5">
                        <button
                          type="button"
                          onClick={() => cancel(job.id)}
                          disabled={cancelling.has(job.id)}
                          className="text-[10px] font-semibold text-rose-600 dark:text-rose-400 hover:text-rose-800 dark:hover:text-rose-300 disabled:opacity-40"
                        >
                          {cancelling.has(job.id) ? 'cancelando…' : 'Cancelar'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default QueueWidget;

// ────────────────────────────────────────────────────────────────────────────
// useQueuePolling — owns the kick + 4s poll loop for a set of enqueued job ids.
//
// The builder calls this with the ids returned from /api/campaigns/create. It
// immediately POSTs the tick (the latency "kick"), then polls
// GET /api/campaigns/jobs?active=1 every 4s and re-POSTs the tick while any of
// OUR jobs is still pending/running. Stops cleanly once all pinned jobs leave
// the active set (or on unmount).
// ────────────────────────────────────────────────────────────────────────────

const POLL_MS = 4000;

export function useQueuePolling(pinnedIds: number[]): QueueJobRow[] {
  const [rows, setRows] = useState<QueueJobRow[]>([]);
  // Keep the latest pinned ids in a ref so the interval closure always sees them
  // without resubscribing the timer on every render.
  const idsRef = useRef<number[]>(pinnedIds);
  idsRef.current = pinnedIds;

  useEffect(() => {
    // Clear any rows from a PREVIOUS pinned-id set the instant the set changes.
    // Without this, a second enqueue (new ids) keeps batch A's rows on screen
    // until batch B's first poll resolves (kick + fetch latency), so the widget
    // briefly renders jobs that are no longer pinned. Resetting here — for both
    // the empty and the switch-to-a-different-non-empty case — guarantees the
    // widget never shows stale rows whose ids are not in the current pinned set.
    setRows([]);
    if (pinnedIds.length === 0) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const kick = async () => {
      try {
        await fetch('/api/campaigns/queue/tick', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
      } catch {
        // The cron poller is the safety net; a failed kick just costs latency.
      }
    };

    const tickAndPoll = async () => {
      if (cancelled) return;
      let active = false;
      try {
        const res = await fetch('/api/campaigns/jobs?active=1', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          const all: QueueJobRow[] = data.jobs ?? [];
          const ids = new Set(idsRef.current);
          const mine = all.filter(j => ids.has(j.id));
          if (!cancelled) setRows(mine);
          active = mine.some(j => ACTIVE_STATUSES.has(j.status));
        }
      } catch {
        // Network hiccup — keep the previous rows and retry next interval.
        active = true;
      }
      if (cancelled) return;
      if (active) {
        await kick();
        timer = setTimeout(tickAndPoll, POLL_MS);
      }
      // When no pinned job is active anymore we stop polling but keep the last
      // rows on screen so the user sees the final done/error state.
    };

    // Initial kick + immediate poll.
    kick().then(tickAndPoll);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedIds.length === 0, pinnedIds.join(',')]);

  return rows;
}
