# Meta Pages — Sync Architecture (chunked / incremental / resumable)

Status as of 2026-05-29, branch `feature/page-sync-background-job` (local only, not pushed).
Decision records: [`../docs/adr/0001-page-sync-background-job.md`](../docs/adr/0001-page-sync-background-job.md)
and [`../docs/adr/0002-page-sync-chunked-resumable.md`](../docs/adr/0002-page-sync-chunked-resumable.md).

## Why this shape

The original inline sync ran the whole job inside one HTTP request: it died at the App
Hosting load-balancer's hard **300s** timeout and tripped Meta's shared **#4** app rate
limit. A first redesign moved it to a background job on the 1200s cron channel — but live
testing at full scale (475 ad accounts; `p133` alone has 63 Business Managers) proved a
**single pass is non-viable**: discovery alone took ~370s, the `ads_volume` sweep saturated
`#4` and crawled, and the end-only upsert persisted nothing on an incomplete run. Hence the
current **chunked, incrementally-persisted, resumable** design.

## How it works

Two operations share the `page_sync_jobs` table via a `kind` column and an integer `cursor`:

- **Refresh Limits** (`kind='refresh'`, primary/frequent): sweeps the **distinct** ad accounts
  from `meta_ad_accounts` in batches, calls `ads_volume` per account (account-scoped → one
  call per account suffices, via `tokensForAccount`), and **upserts `ad_limit`/`ads_running`
  per batch**. No BM walk. `cursor` = account offset.
- **Discover Pages** (`kind='discovery'`, on-demand/rare): walks **one profile per tick**'s
  Business Managers and **upserts that profile's pages per tick** (unioning
  `accessible_profiles`). `cursor` = profile index.

Flow:
1. UI button → `POST /api/pages/sync` with `{ kind, profiles? }` → inserts a `pending`
   `page_sync_jobs` row, returns `{ job_id }` instantly.
2. Cloud Scheduler (~every 2 min) → `POST /api/cron/pages-sync` (`maxDuration=1200`, auth via
   `CRON_SECRET`). It claims the oldest runnable job (`FOR UPDATE SKIP LOCKED` + a
   `leased_until` lease; a `running` job whose lease was released to `NULL` is re-claimable to
   **continue**), runs **exactly one chunk**, then either `completeJob` (cursor exhausted) or
   `advanceAndRelease` (persist cursor, clear lease → next tick continues). The inter-tick gap
   lets `#4` recover — the anti-crawl mechanism.
3. UI polls `GET /api/pages/sync/status?job_id=N` (~2.5s) and reloads on `done`.

The refresh chunk is **time-boxed** (`REFRESH_TIME_BUDGET_MS`, ~180s): it stops after the
budget (or the batch), persists what it processed, and advances the cursor by exactly that
many — so a chunk always fits the cron window and always makes progress.

## Files

| File | Role |
|---|---|
| `lib/sync-jobs.ts` | `page_sync_jobs` table (`kind`,`cursor`,lease); `createPageSyncJob({kind,profiles})`, `claimNextPageSyncJob` (continuation-aware), `advanceAndRelease`, `completeJob`, `failJob`, `getJob` |
| `lib/meta-pages.ts` | `runRefreshChunk` (time-boxed, incremental upsert), `runDiscoveryChunk` (per-profile, incremental upsert), `tokensForAccount`, `discoverPagesForProfile`, `fetchAdsVolumePagedPaced` |
| `lib/meta-pages-pacing.ts` | `Pacer` — adaptive backoff steered by `x-app-usage`/`x-business-use-case-usage`/`x-ad-account-usage` |
| `app/api/pages/sync/route.ts` | enqueue (`{kind,profiles}`) |
| `app/api/pages/sync/status/route.ts` | poll job status |
| `app/api/cron/pages-sync/route.ts` | Scheduler worker — one chunk per tick |
| `app/paginas/ClientStatusPaginas.tsx` | **Atualizar limites** (refresh) + **Buscar páginas** (discovery) buttons; start-then-poll |

## Verification status (IMPORTANT — read before relying on this)

- ✅ **Discovery: live-verified** end-to-end (scoped to P222): walked its BMs, upserted pages
  with `accessible_profiles`, completed correctly.
- ✅ **Job machinery: verified** — continuation re-claim (insert → claim → `advanceAndRelease` →
  re-claim same job at advanced cursor), incremental per-chunk upsert, and the chunk logic
  (offset paging, MAX-not-sum, partial handling) confirmed by review + DB-level tests.
- ✅ **Refresh: live-verified to progress + persist + advance + resume**, even under a *throttled*
  quota. One tick against a still-recovering `#4` processed 4 accounts, **persisted +31 pages'
  limits**, advanced the cursor `0 → 4`, and left the job `running` (released) for the next tick.
  No stall, no infinite loop.

### Throughput adapts to quota health (by design)

The refresh self-paces: a time-boxed chunk does **~100 accounts when `#4` is healthy** (~5 ticks
to drain all 475) and **fewer when throttled** (observed ~4/tick at ~75s/account under heavy
throttle). It **always** persists per chunk and advances the cursor, and **resumes from the
cursor** as quota recovers — so it converges regardless of quota state, never corrupts, never
loops. The only cost of a throttled quota is wall-clock (more ticks); since it's background, that's
acceptable.

**Optional future hardening** (not required — the design is correct as-is; only worth it if you
want the *throttled* case to finish faster / waste fewer calls): (a) make `fetchGraphWithRetry`
deadline-aware so one slow account can't dominate a chunk; (b) on a chunk-level `#4`, set a job
`retry_after` (15–30 min) so the Scheduler backs off instead of retrying every 2 min while maxed.

## Operational runbook

Register the Cloud Scheduler job (operator action — needs GCP creds + the real `CRON_SECRET`):
```
gcloud scheduler jobs create http pages-sync-poller \
  --location=REGION \
  --schedule="*/2 * * * *" \
  --time-zone="America/Sao_Paulo" \
  --uri="https://v2-media-lab--v2-media-lab.us-central1.hosted.app/api/cron/pages-sync" \
  --http-method=POST \
  --headers="Authorization=Bearer YOUR_CRON_SECRET"
```
- `CRON_SECRET` is stored as the `cron-secret@3` secret (see `apphosting.yaml`); rotating it
  means updating the scheduler job's `Authorization` header too.
- **`meta_ad_accounts` must be populated/fresh** (by the existing accounts sync) — refresh reads
  the distinct account list from it.
- Until the Scheduler job exists, enqueued jobs sit `pending` (the UI poll spins).
