# Graph Report - .  (2026-06-08)

## Corpus Check
- 124 files · ~114,793 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 550 nodes · 652 edges · 86 communities detected
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.74)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]

## God Nodes (most connected - your core abstractions)
1. `POST()` - 37 edges
2. `GET()` - 25 edges
3. `postGraph()` - 7 edges
4. `createCampaignBatch()` - 7 edges
5. `fetchGraphWithRetry()` - 7 edges
6. `POST /traffic_origin/stats` - 7 edges
7. `createAdCreative()` - 6 edges
8. `ensureIgnoredProductsTable()` - 6 edges
9. `updateProductVideo()` - 6 edges
10. `vturbPost()` - 6 edges

## Surprising Connections (you probably didn't know these)
- `handle()` --calls--> `GET()`  [EXTRACTED]
  app\api\campaigns\businesses\route.ts → app\api\status-contas\sync\route.ts
- `handleGet()` --calls--> `GET()`  [EXTRACTED]
  app\api\campaigns\catalogs\route.ts → app\api\status-contas\sync\route.ts
- `POST()` --calls--> `validateConfig()`  [EXTRACTED]
  app\api\vturb\sync-players\route.ts → app\api\catalogs\product-presets\route.ts
- `POST()` --calls--> `validatePreset()`  [EXTRACTED]
  app\api\vturb\sync-players\route.ts → app\api\catalogs\products\route.ts
- `POST()` --calls--> `aggregateByKey()`  [EXTRACTED]
  app\api\vturb\sync-players\route.ts → app\api\history\route.ts

## Hyperedges (group relationships)
- **Vturb Retention Pipeline (UTM -> Events -> Aggregation -> Rates)** — vturb_utm_campaign_format, vturb_session_events, vturb_endpoint_traffic_origin_stats, vturb_extract_campaign_id_fn, vturb_vturb_map, vturb_play_rate, vturb_over_pitch_rate, vturb_click_rate [EXTRACTED 0.95]
- **VSL Funnel Events (viewed -> started -> over_pitch -> clicked)** — vturb_event_viewed, vturb_event_started, vturb_event_over_pitch, vturb_event_clicked [EXTRACTED 0.95]
- **Vturb API Call Sequence** — vturb_endpoint_players_list, vturb_endpoint_total_by_company_players, vturb_endpoint_traffic_origin_stats, vturb_auth_x_api_token [EXTRACTED 0.90]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (18): aggregateByKey(), combineDailyRtAd(), combineDailyRtCamp(), combineDailyRtCampById(), DELETE(), ensureColumns(), ensureSchema(), ensureTable() (+10 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (11): addChild(), applyPresetConfig(), buildCurrentPresetConfig(), emptyAd(), emptyChild(), handleApplyPreset(), handleSavePreset(), handleSingleUpload() (+3 more)

### Community 2 - "Community 2"
Cohesion: 0.13
Nodes (20): buildMetaErrorMessage(), buildObjectStorySpec(), createAd(), createAdCreative(), createAdSet(), createCampaign(), createCampaignBatch(), createFullCampaign() (+12 more)

### Community 3 - "Community 3"
Cohesion: 0.14
Nodes (26): brtDayMonth(), buildMetaErrorMessage(), createProductSetWithRetry(), createProductWithSet(), createProductWithSetUsingToken(), deletePreset(), ensureCatalogProductsTable(), ensureIgnoredProductsTable() (+18 more)

### Community 4 - "Community 4"
Cohesion: 0.1
Nodes (28): Context Navigation Policy, Knowledge Graph First Rule, Next.js Agent Rules (Breaking Changes), node_modules/next/dist/docs/, graphify-out/wiki/index.md, CLAUDE.md (include AGENTS.md), app/page.tsx Entry Point, Development Server (npm run dev) (+20 more)

### Community 5 - "Community 5"
Cohesion: 0.12
Nodes (20): Vturb Analytics API (analytics.vturb.net v1), Auth: X-Api-Token + X-Api-Version, Caching: Redis ~10min TTL, GET /players/list, POST /events/total_by_company_players, POST /traffic_origin/stats, extractCampaignId() function, facebook.rows (FB metrics) (+12 more)

### Community 6 - "Community 6"
Cohesion: 0.12
Nodes (4): handleUnignoreProduct(), handleVideoSync(), loadVideoData(), openVideoModal()

### Community 7 - "Community 7"
Cohesion: 0.12
Nodes (2): handleImport(), handleSyncToday()

### Community 8 - "Community 8"
Cohesion: 0.14
Nodes (2): handleImport(), handleSyncToday()

### Community 9 - "Community 9"
Cohesion: 0.15
Nodes (3): handleSync(), handleSyncStatus(), runStreamedSync()

### Community 10 - "Community 10"
Cohesion: 0.25
Nodes (13): AppRateLimitError, discoverPagesForProfile(), fetchAdsVolumePagedPaced(), fetchAllPages(), fetchGraphWithRetry(), listAllBMs(), maxAppUsagePct(), maxNestedUsagePct() (+5 more)

### Community 11 - "Community 11"
Cohesion: 0.21
Nodes (4): applyPicker(), commitAccountLink(), commitLink(), ofertaName()

### Community 12 - "Community 12"
Cohesion: 0.36
Nodes (10): discoverBmCandidates(), ensureCatalogsTable(), fetchAllPages(), fetchAllPagesWithError(), fetchAndSyncMetaCatalogs(), fetchBmCatalogsDetailed(), fetchGraphWithRetry(), getCatalogsFromDB() (+2 more)

### Community 13 - "Community 13"
Cohesion: 0.36
Nodes (10): buildVturbCampaignMap(), fetchVturbActivePlayerIds(), fetchVturbPlayerCampaignStats(), fetchVturbPlayerDaily(), fetchVturbPlayers(), fetchVturbPlayerUtmDaily(), headers(), normalizeCampaignName() (+2 more)

### Community 14 - "Community 14"
Cohesion: 0.22
Nodes (2): countActiveSets(), isActive()

### Community 15 - "Community 15"
Cohesion: 0.36
Nodes (9): createUser(), deleteUser(), isValidEmail(), isValidPageKey(), requireAdmin(), requireSuperAdmin(), setUserPageAccess(), togglePageAccess() (+1 more)

### Community 16 - "Community 16"
Cohesion: 0.22
Nodes (0): 

### Community 17 - "Community 17"
Cohesion: 0.31
Nodes (4): handleDiscover(), handleSync(), runPolledSync(), sleep()

### Community 18 - "Community 18"
Cohesion: 0.39
Nodes (6): computeBackoffMs(), maxFlat(), maxNested(), Pacer, safeParse(), usagePctFromResponse()

### Community 19 - "Community 19"
Cohesion: 0.28
Nodes (3): claimNextPageSyncJob(), createPageSyncJob(), ensureJobTable()

### Community 20 - "Community 20"
Cohesion: 0.25
Nodes (0): 

### Community 21 - "Community 21"
Cohesion: 0.32
Nodes (3): append(), buildPayload(), handleSync()

### Community 22 - "Community 22"
Cohesion: 0.29
Nodes (2): append(), handleSync()

### Community 23 - "Community 23"
Cohesion: 0.52
Nodes (5): analyzeAccounts(), analyzeRecovery(), buildSuggestions(), extractFamily(), formatBRL()

### Community 24 - "Community 24"
Cohesion: 0.33
Nodes (0): 

### Community 25 - "Community 25"
Cohesion: 0.53
Nodes (4): getMetaProfiles(), getRedtrackApiKey(), getVturbApiToken(), loadSettings()

### Community 26 - "Community 26"
Cohesion: 0.47
Nodes (3): fetchAllPages(), fetchAndSyncMetaAccounts(), fetchBmAdAccounts()

### Community 27 - "Community 27"
Cohesion: 0.6
Nodes (5): ensureSchema(), fetchAwesomeApiDaily(), fetchBcbPtax(), getUsdToBrl(), upsertRates()

### Community 28 - "Community 28"
Cohesion: 0.4
Nodes (0): 

### Community 29 - "Community 29"
Cohesion: 0.5
Nodes (2): canAccessPage(), firstAllowedPath()

### Community 30 - "Community 30"
Cohesion: 0.4
Nodes (0): 

### Community 31 - "Community 31"
Cohesion: 0.83
Nodes (3): ensureSettingsTable(), getStoredTokens(), saveApiTokens()

### Community 32 - "Community 32"
Cohesion: 0.5
Nodes (0): 

### Community 33 - "Community 33"
Cohesion: 0.83
Nodes (3): fetchMetaMetrics(), fetchMetaMetricsPerDay(), resolveMetaToken()

### Community 34 - "Community 34"
Cohesion: 0.5
Nodes (0): 

### Community 35 - "Community 35"
Cohesion: 1.0
Nodes (2): loadAccountAuth(), resolveAuth()

### Community 36 - "Community 36"
Cohesion: 0.67
Nodes (0): 

### Community 37 - "Community 37"
Cohesion: 0.67
Nodes (0): 

### Community 38 - "Community 38"
Cohesion: 1.0
Nodes (2): ensureTable(), PaginasPage()

### Community 39 - "Community 39"
Cohesion: 0.67
Nodes (0): 

### Community 40 - "Community 40"
Cohesion: 1.0
Nodes (2): ensureBlacklistSchema(), SettingsPage()

### Community 41 - "Community 41"
Cohesion: 1.0
Nodes (2): ensureColumns(), StatusContasPage()

### Community 42 - "Community 42"
Cohesion: 1.0
Nodes (2): handleStaleServerAction(), isStaleServerActionError()

### Community 43 - "Community 43"
Cohesion: 1.0
Nodes (0): 

### Community 44 - "Community 44"
Cohesion: 1.0
Nodes (0): 

### Community 45 - "Community 45"
Cohesion: 1.0
Nodes (0): 

### Community 46 - "Community 46"
Cohesion: 1.0
Nodes (0): 

### Community 47 - "Community 47"
Cohesion: 1.0
Nodes (0): 

### Community 48 - "Community 48"
Cohesion: 1.0
Nodes (0): 

### Community 49 - "Community 49"
Cohesion: 1.0
Nodes (0): 

### Community 50 - "Community 50"
Cohesion: 1.0
Nodes (0): 

### Community 51 - "Community 51"
Cohesion: 1.0
Nodes (0): 

### Community 52 - "Community 52"
Cohesion: 1.0
Nodes (0): 

### Community 53 - "Community 53"
Cohesion: 1.0
Nodes (0): 

### Community 54 - "Community 54"
Cohesion: 1.0
Nodes (0): 

### Community 55 - "Community 55"
Cohesion: 1.0
Nodes (0): 

### Community 56 - "Community 56"
Cohesion: 1.0
Nodes (0): 

### Community 57 - "Community 57"
Cohesion: 1.0
Nodes (0): 

### Community 58 - "Community 58"
Cohesion: 1.0
Nodes (0): 

### Community 59 - "Community 59"
Cohesion: 1.0
Nodes (0): 

### Community 60 - "Community 60"
Cohesion: 1.0
Nodes (0): 

### Community 61 - "Community 61"
Cohesion: 1.0
Nodes (0): 

### Community 62 - "Community 62"
Cohesion: 1.0
Nodes (0): 

### Community 63 - "Community 63"
Cohesion: 1.0
Nodes (0): 

### Community 64 - "Community 64"
Cohesion: 1.0
Nodes (0): 

### Community 65 - "Community 65"
Cohesion: 1.0
Nodes (0): 

### Community 66 - "Community 66"
Cohesion: 1.0
Nodes (0): 

### Community 67 - "Community 67"
Cohesion: 1.0
Nodes (0): 

### Community 68 - "Community 68"
Cohesion: 1.0
Nodes (0): 

### Community 69 - "Community 69"
Cohesion: 1.0
Nodes (0): 

### Community 70 - "Community 70"
Cohesion: 1.0
Nodes (0): 

### Community 71 - "Community 71"
Cohesion: 1.0
Nodes (0): 

### Community 72 - "Community 72"
Cohesion: 1.0
Nodes (0): 

### Community 73 - "Community 73"
Cohesion: 1.0
Nodes (0): 

### Community 74 - "Community 74"
Cohesion: 1.0
Nodes (0): 

### Community 75 - "Community 75"
Cohesion: 1.0
Nodes (0): 

### Community 76 - "Community 76"
Cohesion: 1.0
Nodes (0): 

### Community 77 - "Community 77"
Cohesion: 1.0
Nodes (0): 

### Community 78 - "Community 78"
Cohesion: 1.0
Nodes (0): 

### Community 79 - "Community 79"
Cohesion: 1.0
Nodes (0): 

### Community 80 - "Community 80"
Cohesion: 1.0
Nodes (0): 

### Community 81 - "Community 81"
Cohesion: 1.0
Nodes (0): 

### Community 82 - "Community 82"
Cohesion: 1.0
Nodes (0): 

### Community 83 - "Community 83"
Cohesion: 1.0
Nodes (0): 

### Community 84 - "Community 84"
Cohesion: 1.0
Nodes (0): 

### Community 85 - "Community 85"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **16 isolated node(s):** `node_modules/next/dist/docs/`, `Knowledge Graph First Rule`, `graphify-out/wiki/index.md`, `app/page.tsx Entry Point`, `next/font + Geist` (+11 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 43`** (2 nodes): `test_rt_pag.js`, `run()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (2 nodes): `HomeSignOut.tsx`, `HomeSignOut()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (2 nodes): `layout.tsx`, `RootLayout()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (2 nodes): `page.tsx`, `AnalisePage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (2 nodes): `page.tsx`, `ApiConfigPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (2 nodes): `page.tsx`, `CampaignsPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (2 nodes): `page.tsx`, `CatalogoPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (2 nodes): `OfferSelector.tsx`, `OfferSelector()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (2 nodes): `SessionProvider.tsx`, `SessionProvider()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (2 nodes): `ThemeToggle.tsx`, `ThemeToggle()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (2 nodes): `page.tsx`, `DataStudioPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (2 nodes): `page.tsx`, `ImportPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (2 nodes): `page.tsx`, `ImportV2Page()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (2 nodes): `AccountStatusBadge()`, `accountStatus.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (2 nodes): `page.tsx`, `OfertasPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 58`** (2 nodes): `page.tsx`, `OverviewPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (2 nodes): `page.tsx`, `UsersPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (2 nodes): `UsersClient.tsx`, `run()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (2 nodes): `loadUserAccess()`, `access-server.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (2 nodes): `meta-pages-pacing.test.ts`, `resWith()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (2 nodes): `offer-scope.ts`, `parseOfertaParam()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (2 nodes): `redtrack-campaigns.ts`, `fetchAndSyncRedTrackCampaigns()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 65`** (2 nodes): `redtrack-cost.test.ts`, `agg()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (2 nodes): `redtrack-cost.ts`, `matchRtCampaignCost()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 67`** (1 nodes): `auth.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 68`** (1 nodes): `next-env.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 69`** (1 nodes): `next.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (1 nodes): `proxy.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 71`** (1 nodes): `vitest.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 72`** (1 nodes): `page.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 73`** (1 nodes): `route.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 74`** (1 nodes): `DopScaleLayout.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 75`** (1 nodes): `V2MediaLabLayout.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 76`** (1 nodes): `reactSelectStyles.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 77`** (1 nodes): `theme.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 78`** (1 nodes): `page.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 79`** (1 nodes): `db.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 80`** (1 nodes): `meta-pages.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 81`** (1 nodes): `offer-links.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 82`** (1 nodes): `offer-scope.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 83`** (1 nodes): `supabase.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 84`** (1 nodes): `types.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 85`** (1 nodes): `next-auth.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vturbMap (aggregation by campaign_id)` connect `Community 4` to `Community 5`?**
  _High betweenness centrality (0.004) - this node is a cross-community bridge._
- **What connects `node_modules/next/dist/docs/`, `Knowledge Graph First Rule`, `graphify-out/wiki/index.md` to the rest of the system?**
  _16 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.13 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.14 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._