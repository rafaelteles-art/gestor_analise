# Campaign Queue + Drive — Deploy Runbook

Branch: `feature/campaign-queue-8features` → merge to `master` (App Hosting deploys from `master`).
Project: `v2-media-lab` · Region: `us-central1` · App: `https://v2-media-lab--v2-media-lab.us-central1.hosted.app`

Status legend: 🔴 human-only · 🟡 needs gcloud auth · 🟢 done / agent-doable

---

## 0. 🔴 Restore gcloud auth (blocks everything GCP)
The agent's gcloud token expired (`Reauthentication failed … cannot prompt`). Run interactively:
```
gcloud auth login
gcloud config set project v2-media-lab
```

## 1. 🔴 OAuth client (Console — reusing the login client 611439523851-…)
APIs & Services → Credentials → OAuth 2.0 Client `611439523851-si73k5u0ptla7fn2vu8cfbstrf0li71u`:
- **Authorized redirect URIs** → add:
  `https://v2-media-lab--v2-media-lab.us-central1.hosted.app/api/google/oauth/callback`
- OAuth consent screen → **Scopes** → add `https://www.googleapis.com/auth/drive.readonly`.
- No new client secret needed — `GOOGLE_OAUTH_CLIENT_SECRET` reuses Secret Manager `google-client-secret` (already wired in apphosting.yaml).

## 2. 🟡 Enable APIs (after step 0)
```
gcloud services enable drive.googleapis.com --project=v2-media-lab
# Picker API service name — confirm first (auth was down when checked):
gcloud services list --available --filter="displayName:Picker" --format="value(config.name)" --project=v2-media-lab
gcloud services enable <picker-service-name> --project=v2-media-lab
```

## 3. 🟡 Picker API key → fill apphosting.yaml
Console → Credentials → Create API key. Restrict: **API restrictions** = Picker API (+ Drive API); **Application restrictions** = HTTP referrers = `https://v2-media-lab--v2-media-lab.us-central1.hosted.app/*`.
Then replace the placeholder in `apphosting.yaml`:
```
NEXT_PUBLIC_GOOGLE_API_KEY: value: REPLACE_WITH_PICKER_API_KEY  →  the real key
```
(CLI alt: `gcloud services api-keys create --display-name="picker-report" --project=v2-media-lab`, then read the keyString.)

## 4. 🟢 apphosting.yaml env wiring — DONE on the feature branch
Added (reuse decision): `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` (→ `google-client-secret`),
`NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_GOOGLE_API_KEY` (placeholder — see step 3).
`CRON_SECRET` already existed (`cron-secret@3`).

## 5. 🟡/🟢 Lockfile check + merge + deploy
Deps changed this branch? (googleapis was NOT added — Drive uses plain fetch.) If `package.json` deps changed, regenerate the lockfile with the deploy's npm to avoid the known skew:
```
npx npm@10 install --package-lock-only   # commit package-lock.json if it changes
```
Then (after steps 1 & 3 are done, API key filled):
```
git checkout master && git merge --no-ff feature/campaign-queue-8features
git push origin master      # triggers App Hosting build+deploy
```
⚠️ Do NOT merge with `NEXT_PUBLIC_GOOGLE_API_KEY` still = placeholder, or the Picker ships broken.

## 6. 🟡 Cloud Scheduler — campaigns-queue-poller (AFTER deploy is live)
Mirrors the existing `account-sync-hourly` job; reuses the same `cron-secret@3` value the route checks.
```
TOKEN=$(gcloud secrets versions access latest --secret=cron-secret --project=v2-media-lab)
gcloud scheduler jobs create http campaigns-queue-poller \
  --location=us-central1 --schedule="*/2 * * * *" --time-zone="America/Sao_Paulo" \
  --uri="https://v2-media-lab--v2-media-lab.us-central1.hosted.app/api/cron/campaigns-queue" \
  --http-method=POST --headers="Authorization=Bearer ${TOKEN},Content-Type=application/json" \
  --message-body="{}" --attempt-deadline=600s --max-retry-attempts=0 --project=v2-media-lab
```
Smoke: `curl -s -X POST -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" -d '{}' .../api/cron/campaigns-queue` → `{"claimed":…,"finished":…}`.

## 7. 🔴 One-time Drive consent (browser, your Google account)
After deploy: app → Settings → **Conectar Google Drive** → approve `drive.readonly`. Stores the refresh token in `app_settings.GOOGLE_DRIVE_OAUTH` for the worker. Verify Settings shows "connected as <email>".

## 8. 🟢 Post-deploy smoke (recommended before real spend)
- Enqueue a 1-creative job → starts <5s, completes, shows in `/campaigns/fila`.
- 2 jobs same Profile → serialize; cancel mid-run → stops at next entity.
- Multi-account broadcast → each account's campaigns carry THAT account's name/nickname (the d1a761a fix).
- DPA creative with empty name → defaults to product-set name minus date.
- Drive picker → job downloads + uploads at execution.
