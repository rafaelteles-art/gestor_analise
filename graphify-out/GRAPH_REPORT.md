# Graph Report - .  (2026-05-13)

## Corpus Check
- 79 files · ~68,528 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 367 nodes · 411 edges · 61 communities detected
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

## God Nodes (most connected - your core abstractions)
1. `POST()` - 20 edges
2. `GET()` - 14 edges
3. `postGraph()` - 7 edges
4. `createCampaignBatch()` - 7 edges
5. `POST /traffic_origin/stats` - 7 edges
6. `vturbPost()` - 6 edges
7. `Vturb Session Events` - 6 edges
8. `vturbMap (aggregation by campaign_id)` - 6 edges
9. `createAdCreative()` - 5 edges
10. `createFullCampaign()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `Next.js Project (create-next-app)` --conceptually_related_to--> `Problema: Retenção por Campanha FB`  [INFERRED]
  README.md → vturb-retencao-por-campanha.md
- `DELETE()` --calls--> `GET()`  [EXTRACTED]
  app\app\api\ofertas\route.ts → app\api\status-contas\sync\route.ts
- `POST()` --calls--> `aggregateByKey()`  [EXTRACTED]
  app\api\sync\vturb-bulk\route.ts → app\api\history\route.ts
- `POST()` --calls--> `combineDailyRtAd()`  [EXTRACTED]
  app\api\sync\vturb-bulk\route.ts → app\api\import\route.ts
- `POST()` --calls--> `combineDailyRtCamp()`  [EXTRACTED]
  app\api\sync\vturb-bulk\route.ts → app\api\import\route.ts

## Hyperedges (group relationships)
- **Vturb Retention Pipeline (UTM -> Events -> Aggregation -> Rates)** — vturb_utm_campaign_format, vturb_session_events, vturb_endpoint_traffic_origin_stats, vturb_extract_campaign_id_fn, vturb_vturb_map, vturb_play_rate, vturb_over_pitch_rate, vturb_click_rate [EXTRACTED 0.95]
- **VSL Funnel Events (viewed -> started -> over_pitch -> clicked)** — vturb_event_viewed, vturb_event_started, vturb_event_over_pitch, vturb_event_clicked [EXTRACTED 0.95]
- **Vturb API Call Sequence** — vturb_endpoint_players_list, vturb_endpoint_total_by_company_players, vturb_endpoint_traffic_origin_stats, vturb_auth_x_api_token [EXTRACTED 0.90]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.08
Nodes (11): aggregateByKey(), combineDailyRtAd(), combineDailyRtCamp(), combineDailyRtCampById(), DELETE(), ensureColumns(), ensureTable(), ensureVturbTable() (+3 more)

### Community 1 - "Community 1"
Cohesion: 0.16
Nodes (17): buildMetaErrorMessage(), buildObjectStorySpec(), createAd(), createAdCreative(), createAdSet(), createCampaign(), createCampaignBatch(), createFullCampaign() (+9 more)

### Community 2 - "Community 2"
Cohesion: 0.11
Nodes (5): handleDeleteTemplate(), handleImport(), handleSaveTemplate(), handleSyncToday(), persistTemplates()

### Community 3 - "Community 3"
Cohesion: 0.12
Nodes (20): Vturb Analytics API (analytics.vturb.net v1), Auth: X-Api-Token + X-Api-Version, Caching: Redis ~10min TTL, GET /players/list, POST /events/total_by_company_players, POST /traffic_origin/stats, extractCampaignId() function, facebook.rows (FB metrics) (+12 more)

### Community 4 - "Community 4"
Cohesion: 0.13
Nodes (6): addChild(), emptyAd(), emptyChild(), handleSingleUpload(), makeId(), uploadFor()

### Community 5 - "Community 5"
Cohesion: 0.12
Nodes (5): handleDeleteTemplate(), handleImport(), handleSaveTemplate(), handleSyncToday(), persistTemplates()

### Community 6 - "Community 6"
Cohesion: 0.18
Nodes (17): Metric: click_rate, Event: clicked, Event: over_pitch, Event: started, Event: viewed, Facebook Ad (clique), FB Macro {{campaign.id}}, Metric: over_pitch_rate (+9 more)

### Community 7 - "Community 7"
Cohesion: 0.14
Nodes (3): handleSync(), handleSyncStatus(), runStreamedSync()

### Community 8 - "Community 8"
Cohesion: 0.36
Nodes (10): buildVturbCampaignMap(), fetchVturbActivePlayerIds(), fetchVturbPlayerCampaignStats(), fetchVturbPlayerDaily(), fetchVturbPlayers(), fetchVturbPlayerUtmDaily(), headers(), normalizeCampaignName() (+2 more)

### Community 9 - "Community 9"
Cohesion: 0.18
Nodes (11): Context Navigation Policy, Knowledge Graph First Rule, Next.js Agent Rules (Breaking Changes), node_modules/next/dist/docs/, graphify-out/wiki/index.md, CLAUDE.md (include AGENTS.md), app/page.tsx Entry Point, Development Server (npm run dev) (+3 more)

### Community 10 - "Community 10"
Cohesion: 0.22
Nodes (2): countActiveSets(), isActive()

### Community 11 - "Community 11"
Cohesion: 0.36
Nodes (9): createUser(), deleteUser(), isValidEmail(), isValidPageKey(), requireAdmin(), requireSuperAdmin(), setUserPageAccess(), togglePageAccess() (+1 more)

### Community 12 - "Community 12"
Cohesion: 0.22
Nodes (0): 

### Community 13 - "Community 13"
Cohesion: 0.28
Nodes (3): append(), buildPayload(), handleSync()

### Community 14 - "Community 14"
Cohesion: 0.29
Nodes (2): append(), handleSync()

### Community 15 - "Community 15"
Cohesion: 0.52
Nodes (5): analyzeAccounts(), analyzeRecovery(), buildSuggestions(), extractFamily(), formatBRL()

### Community 16 - "Community 16"
Cohesion: 0.29
Nodes (0): 

### Community 17 - "Community 17"
Cohesion: 0.29
Nodes (0): 

### Community 18 - "Community 18"
Cohesion: 0.53
Nodes (4): getMetaProfiles(), getRedtrackApiKey(), getVturbApiToken(), loadSettings()

### Community 19 - "Community 19"
Cohesion: 0.53
Nodes (3): fetchAllPages(), fetchAndSyncMetaAccounts(), fetchBmAdAccounts()

### Community 20 - "Community 20"
Cohesion: 0.6
Nodes (5): ensureSchema(), fetchAwesomeApiDaily(), fetchBcbPtax(), getUsdToBrl(), upsertRates()

### Community 21 - "Community 21"
Cohesion: 0.4
Nodes (0): 

### Community 22 - "Community 22"
Cohesion: 0.4
Nodes (0): 

### Community 23 - "Community 23"
Cohesion: 0.5
Nodes (2): canAccessPage(), firstAllowedPath()

### Community 24 - "Community 24"
Cohesion: 0.83
Nodes (3): ensureSettingsTable(), getStoredTokens(), saveApiTokens()

### Community 25 - "Community 25"
Cohesion: 0.83
Nodes (3): fetchMetaMetrics(), fetchMetaMetricsPerDay(), resolveMetaToken()

### Community 26 - "Community 26"
Cohesion: 0.5
Nodes (0): 

### Community 27 - "Community 27"
Cohesion: 1.0
Nodes (2): loadAccountAuth(), resolveAuth()

### Community 28 - "Community 28"
Cohesion: 0.67
Nodes (0): 

### Community 29 - "Community 29"
Cohesion: 1.0
Nodes (2): ensureTable(), OfertasPage()

### Community 30 - "Community 30"
Cohesion: 1.0
Nodes (2): ensureBlacklistSchema(), SettingsPage()

### Community 31 - "Community 31"
Cohesion: 0.67
Nodes (0): 

### Community 32 - "Community 32"
Cohesion: 1.0
Nodes (2): ensureColumns(), StatusContasPage()

### Community 33 - "Community 33"
Cohesion: 1.0
Nodes (2): handleStaleServerAction(), isStaleServerActionError()

### Community 34 - "Community 34"
Cohesion: 1.0
Nodes (0): 

### Community 35 - "Community 35"
Cohesion: 1.0
Nodes (0): 

### Community 36 - "Community 36"
Cohesion: 1.0
Nodes (0): 

### Community 37 - "Community 37"
Cohesion: 1.0
Nodes (0): 

### Community 38 - "Community 38"
Cohesion: 1.0
Nodes (0): 

### Community 39 - "Community 39"
Cohesion: 1.0
Nodes (0): 

### Community 40 - "Community 40"
Cohesion: 1.0
Nodes (0): 

### Community 41 - "Community 41"
Cohesion: 1.0
Nodes (0): 

### Community 42 - "Community 42"
Cohesion: 1.0
Nodes (0): 

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

## Knowledge Gaps
- **16 isolated node(s):** `node_modules/next/dist/docs/`, `Knowledge Graph First Rule`, `graphify-out/wiki/index.md`, `app/page.tsx Entry Point`, `next/font + Geist` (+11 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 34`** (2 nodes): `test_rt_pag.js`, `run()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (2 nodes): `HomeSignOut.tsx`, `HomeSignOut()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (2 nodes): `layout.tsx`, `RootLayout()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (2 nodes): `page.tsx`, `AnalisePage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (2 nodes): `page.tsx`, `ApiConfigPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (2 nodes): `page.tsx`, `CampaignsPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (2 nodes): `SessionProvider.tsx`, `SessionProvider()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (2 nodes): `page.tsx`, `DataStudioPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (2 nodes): `page.tsx`, `ImportPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (2 nodes): `page.tsx`, `ImportV2Page()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (2 nodes): `page.tsx`, `UsersPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (2 nodes): `UsersClient.tsx`, `run()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (2 nodes): `loadUserAccess()`, `access-server.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (2 nodes): `redtrack-campaigns.ts`, `fetchAndSyncRedTrackCampaigns()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (1 nodes): `auth.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (1 nodes): `next-env.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (1 nodes): `next.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (1 nodes): `proxy.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (1 nodes): `page.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (1 nodes): `route.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (1 nodes): `DopScaleLayout.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (1 nodes): `V2MediaLabLayout.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (1 nodes): `page.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (1 nodes): `db.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 58`** (1 nodes): `supabase.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (1 nodes): `types.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (1 nodes): `next-auth.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vturbMap (aggregation by campaign_id)` connect `Community 6` to `Community 3`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **What connects `node_modules/next/dist/docs/`, `Knowledge Graph First Rule`, `graphify-out/wiki/index.md` to the rest of the system?**
  _16 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.11 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.12 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.13 - nodes in this community are weakly interconnected._
- **Should `Community 5` be split into smaller, more focused modules?**
  _Cohesion score 0.12 - nodes in this community are weakly interconnected._