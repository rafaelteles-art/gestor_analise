# Meta Pages — Background Job Architecture

Handoff document for the page-sync feature. The feature is complete end-to-end.

---

## 1. Overview

Page sync runs as a **background job**, not a blocking user-facing request.

### Flow

1. User clicks "Sincronizar" on `/paginas`.
2. `POST /api/pages/sync` inserts a row in `page_sync_jobs` (status `pending`) and returns `{ job_id }` immediately.
3. Cloud Scheduler fires `POST /api/cron/pages-sync` every ~2 minutes (`maxDuration = 1200`).
4. The cron worker claims the oldest runnable job atomically (`SELECT … FOR UPDATE SKIP LOCKED` + `leased_until` lease).
5. Worker calls `runPageSyncJob`, which discovers pages and reads `ads_volume` per account, then upserts `meta_pages`.
6. The UI (`ClientStatusPaginas.tsx`) polls `GET /api/pages/sync/status?job_id=N` every ~2.5 s and reloads when status is `done`.

### Why

The old inline streaming sync died at the App Hosting load-balancer hard timeout (300 s) and tripped Meta's shared app-level #4 rate limit. The Cloud Scheduler channel provides up to 1200 s, and the paced, deduped account walk reduces calls from ~746 to ~475.

---

## 2. Key Mechanics

### Tokens

System User tokens are kept (not personal tokens). Resolved via `tokensForAccount`: given a list of `accessible_profiles` for an ad account, returns ordered unique tokens from the live profile→token map. Multiple tokens serve as auth fallbacks only — `ads_volume` is account-scoped so any working token returns the same data.

### Account list source

The worker reads the DISTINCT ad-account list from `meta_ad_accounts` (populated by the existing accounts sync). One `ads_volume` call per account suffices (account-scoped result). This deduplication is the core call-count reduction: ~746 ad accounts across all profiles → ~475 unique `account_id` rows in the DB.

### Adaptive pacing

`Pacer` (in `lib/meta-pages-pacing.ts`) reads `x-app-usage`, `x-business-use-case-usage`, and `x-ad-account-usage` headers from every Graph response and adjusts the inter-request delay accordingly. `fetchGraphWithRetry` passes the pacer to every fetch.

### App-level #4 handling

`fetchGraphWithRetry` distinguishes a true app-level #4 (x-app-usage ≥ 80%) from a BUC/ad-account #4 (lower app usage). True app-level → throws `AppRateLimitError`, which the worker catches: it saves what it collected so far (`partial: true`) and marks the job `done` with a partial flag rather than `failed`.

---

## 3. Files

| File | Role |
|------|------|
| `lib/meta-pages.ts` | Core: `runPageSyncJob`, `discoverPagesForProfile`, `tokensForAccount`, `fetchAdsVolumePagedPaced` |
| `lib/meta-pages-pacing.ts` | `Pacer` class — adaptive delay from usage headers |
| `lib/sync-jobs.ts` | `page_sync_jobs` table lifecycle (create, claim, complete, fail) |
| `app/api/pages/sync/route.ts` | `POST` — enqueue job; `GET` — (not used, superseded by status route) |
| `app/api/pages/sync/status/route.ts` | `GET /api/pages/sync/status?job_id=N` — poll endpoint for UI |
| `app/api/cron/pages-sync/route.ts` | Cron worker — claims job, runs `runPageSyncJob`, updates status |
| `app/paginas/ClientStatusPaginas.tsx` | Start-sync button + polling UI |

Related ADR (outside this repo):
`C:\Apps\REPORT\docs\adr\0001-page-sync-background-job.md`

---

## 4. Operational Runbook

### Register the Cloud Scheduler job (one-time, operator action)

Fill in `REGION` (e.g. `us-central1`) and `YOUR_CRON_SECRET` from the `cron-secret@3` secret (see `apphosting.yaml`):

```sh
gcloud scheduler jobs create http pages-sync-poller \
  --location=REGION \
  --schedule="*/2 * * * *" \
  --time-zone="America/Sao_Paulo" \
  --uri="https://v2-media-lab--v2-media-lab.us-central1.hosted.app/api/cron/pages-sync" \
  --http-method=POST \
  --headers="Authorization=Bearer YOUR_CRON_SECRET"
```

If `CRON_SECRET` is ever rotated, update the scheduler job's `Authorization` header to match.

### Prerequisites

- `meta_ad_accounts` must be populated (run the accounts sync first). The page sync sources its account list from this table.
- `META_PROFILES` must be configured in `app_settings` (via `/api-config`).

### Monitoring

- Job rows are in `page_sync_jobs`. Check `status`, `error`, and `progress_message` columns.
- App-level rate limits produce `partial = true` jobs (not failures) — the partial data is saved and the job completes normally.
- Logs from `runPageSyncJob` are prefixed `[meta-pages]`.
