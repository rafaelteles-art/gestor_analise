# Graph Report - .  (2026-05-11)

## Corpus Check
- 84 files · ~57,920 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 348 nodes · 386 edges · 59 communities detected
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.74)
- Token cost: 4,200 input · 7,500 output

## Community Hubs (Navigation)
- [[_COMMUNITY_POST() (+31)|POST() (+31)]]
- [[_COMMUNITY_ClientImport.tsx (+20)|ClientImport.tsx (+20)]]
- [[_COMMUNITY_ClientCampaignBuilder.tsx (+19)|ClientCampaignBuilder.tsx (+19)]]
- [[_COMMUNITY_POST traffic_originstats (+19)|POST /traffic_origin/stats (+19)]]
- [[_COMMUNITY_ClientImportV2.tsx (+18)|ClientImportV2.tsx (+18)]]
- [[_COMMUNITY_meta-campaigns.ts (+16)|meta-campaigns.ts (+16)]]
- [[_COMMUNITY_Vturb Session Events (+16)|Vturb Session Events (+16)]]
- [[_COMMUNITY_ClientStatusContas.tsx (+15)|ClientStatusContas.tsx (+15)]]
- [[_COMMUNITY_vturb.ts (+10)|vturb.ts (+10)]]
- [[_COMMUNITY_Next.js Project (create-next-app) (+10)|Next.js Project (create-next-app) (+10)]]
- [[_COMMUNITY_CampaignHoverPopup.tsx (+9)|CampaignHoverPopup.tsx (+9)]]
- [[_COMMUNITY_actions.ts (+9)|actions.ts (+9)]]
- [[_COMMUNITY_ClientAnalise.tsx (+8)|ClientAnalise.tsx (+8)]]
- [[_COMMUNITY_MetaSyncPanel.tsx (+8)|MetaSyncPanel.tsx (+8)]]
- [[_COMMUNITY_VturbSyncPanel.tsx (+7)|VturbSyncPanel.tsx (+7)]]
- [[_COMMUNITY_diagnostics.ts (+6)|diagnostics.ts (+6)]]
- [[_COMMUNITY_AccountList.tsx (+6)|AccountList.tsx (+6)]]
- [[_COMMUNITY_config.ts (+5)|config.ts (+5)]]
- [[_COMMUNITY_meta-accounts.ts (+5)|meta-accounts.ts (+5)]]
- [[_COMMUNITY_usd-brl.ts (+5)|usd-brl.ts (+5)]]
- [[_COMMUNITY_ClientOfertas.tsx (+4)|ClientOfertas.tsx (+4)]]
- [[_COMMUNITY_actions.ts (+4)|actions.ts (+4)]]
- [[_COMMUNITY_access.ts (+4)|access.ts (+4)]]
- [[_COMMUNITY_ensureSettingsTable() (+3)|ensureSettingsTable() (+3)]]
- [[_COMMUNITY_meta.ts (+3)|meta.ts (+3)]]
- [[_COMMUNITY_redtrack.ts (+3)|redtrack.ts (+3)]]
- [[_COMMUNITY__helpers.ts (+2)|_helpers.ts (+2)]]
- [[_COMMUNITY_hoverCache.ts (+2)|hoverCache.ts (+2)]]
- [[_COMMUNITY_page.tsx (+2)|page.tsx (+2)]]
- [[_COMMUNITY_RtCampaignSelector.tsx (+2)|RtCampaignSelector.tsx (+2)]]
- [[_COMMUNITY_page.tsx (+2)|page.tsx (+2)]]
- [[_COMMUNITY_stale-action.ts (+2)|stale-action.ts (+2)]]
- [[_COMMUNITY_test_rt_pag.js (+1)|test_rt_pag.js (+1)]]
- [[_COMMUNITY_HomeSignOut.tsx (+1)|HomeSignOut.tsx (+1)]]
- [[_COMMUNITY_layout.tsx (+1)|layout.tsx (+1)]]
- [[_COMMUNITY_page.tsx (+1)|page.tsx (+1)]]
- [[_COMMUNITY_page.tsx (+1)|page.tsx (+1)]]
- [[_COMMUNITY_page.tsx (+1)|page.tsx (+1)]]
- [[_COMMUNITY_SessionProvider.tsx (+1)|SessionProvider.tsx (+1)]]
- [[_COMMUNITY_page.tsx (+1)|page.tsx (+1)]]
- [[_COMMUNITY_page.tsx (+1)|page.tsx (+1)]]
- [[_COMMUNITY_page.tsx (+1)|page.tsx (+1)]]
- [[_COMMUNITY_page.tsx (+1)|page.tsx (+1)]]
- [[_COMMUNITY_UsersClient.tsx (+1)|UsersClient.tsx (+1)]]
- [[_COMMUNITY_loadUserAccess() (+1)|loadUserAccess() (+1)]]
- [[_COMMUNITY_redtrack-campaigns.ts (+1)|redtrack-campaigns.ts (+1)]]
- [[_COMMUNITY_auth.ts|auth.ts]]
- [[_COMMUNITY_next-env.d.ts|next-env.d.ts]]
- [[_COMMUNITY_next.config.ts|next.config.ts]]
- [[_COMMUNITY_proxy.ts|proxy.ts]]
- [[_COMMUNITY_page.tsx|page.tsx]]
- [[_COMMUNITY_route.ts|route.ts]]
- [[_COMMUNITY_DopScaleLayout.tsx|DopScaleLayout.tsx]]
- [[_COMMUNITY_V2MediaLabLayout.tsx|V2MediaLabLayout.tsx]]
- [[_COMMUNITY_page.tsx|page.tsx]]
- [[_COMMUNITY_db.ts|db.ts]]
- [[_COMMUNITY_supabase.ts|supabase.ts]]
- [[_COMMUNITY_types.ts|types.ts]]
- [[_COMMUNITY_next-auth.d.ts|next-auth.d.ts]]

## God Nodes (most connected - your core abstractions)
1. `POST()` - 20 edges
2. `GET()` - 11 edges
3. `POST /traffic_origin/stats` - 7 edges
4. `postGraph()` - 6 edges
5. `vturbPost()` - 6 edges
6. `Vturb Session Events` - 6 edges
7. `vturbMap (aggregation by campaign_id)` - 6 edges
8. `createFullCampaign()` - 5 edges
9. `getUsdToBrl()` - 5 edges
10. `Next.js Project (create-next-app)` - 5 edges

## Surprising Connections (you probably didn't know these)
- `Problema: Retenção por Campanha FB` --conceptually_related_to--> `Next.js Project (create-next-app)`  [INFERRED]
  vturb-retencao-por-campanha.md → README.md
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

### Community 0 - "POST() (+31)"
Cohesion: 0.09
Nodes (11): aggregateByKey(), combineDailyRtAd(), combineDailyRtCamp(), combineDailyRtCampById(), DELETE(), ensureColumns(), ensureTable(), ensureVturbTable() (+3 more)

### Community 1 - "ClientImport.tsx (+20)"
Cohesion: 0.11
Nodes (5): handleDeleteTemplate(), handleImport(), handleSaveTemplate(), handleSyncToday(), persistTemplates()

### Community 2 - "ClientCampaignBuilder.tsx (+19)"
Cohesion: 0.14
Nodes (10): addChild(), emptyAd(), emptyChild(), handleSingleUpload(), handleSyncAccounts(), handleUpload(), makeId(), readNdjson() (+2 more)

### Community 3 - "POST /traffic_origin/stats (+19)"
Cohesion: 0.12
Nodes (20): Vturb Analytics API (analytics.vturb.net v1), Auth: X-Api-Token + X-Api-Version, Caching: Redis ~10min TTL, GET /players/list, POST /events/total_by_company_players, POST /traffic_origin/stats, extractCampaignId() function, facebook.rows (FB metrics) (+12 more)

### Community 4 - "ClientImportV2.tsx (+18)"
Cohesion: 0.12
Nodes (5): handleDeleteTemplate(), handleImport(), handleSaveTemplate(), handleSyncToday(), persistTemplates()

### Community 5 - "meta-campaigns.ts (+16)"
Cohesion: 0.19
Nodes (9): buildObjectStorySpec(), createAd(), createAdCreative(), createAdSet(), createCampaign(), createFullCampaign(), createLookalike(), MetaApiError (+1 more)

### Community 6 - "Vturb Session Events (+16)"
Cohesion: 0.18
Nodes (17): Metric: click_rate, Event: clicked, Event: over_pitch, Event: started, Event: viewed, Facebook Ad (clique), FB Macro {{campaign.id}}, Metric: over_pitch_rate (+9 more)

### Community 7 - "ClientStatusContas.tsx (+15)"
Cohesion: 0.14
Nodes (3): handleSync(), handleSyncStatus(), runStreamedSync()

### Community 8 - "vturb.ts (+10)"
Cohesion: 0.36
Nodes (10): buildVturbCampaignMap(), fetchVturbActivePlayerIds(), fetchVturbPlayerCampaignStats(), fetchVturbPlayerDaily(), fetchVturbPlayers(), fetchVturbPlayerUtmDaily(), headers(), normalizeCampaignName() (+2 more)

### Community 9 - "Next.js Project (create-next-app) (+10)"
Cohesion: 0.18
Nodes (11): Context Navigation Policy, Knowledge Graph First Rule, Next.js Agent Rules (Breaking Changes), node_modules/next/dist/docs/, graphify-out/wiki/index.md, CLAUDE.md (include AGENTS.md), app/page.tsx Entry Point, Development Server (npm run dev) (+3 more)

### Community 10 - "CampaignHoverPopup.tsx (+9)"
Cohesion: 0.22
Nodes (2): countActiveSets(), isActive()

### Community 11 - "actions.ts (+9)"
Cohesion: 0.36
Nodes (9): createUser(), deleteUser(), isValidEmail(), isValidPageKey(), requireAdmin(), requireSuperAdmin(), setUserPageAccess(), togglePageAccess() (+1 more)

### Community 12 - "ClientAnalise.tsx (+8)"
Cohesion: 0.22
Nodes (0): 

### Community 13 - "MetaSyncPanel.tsx (+8)"
Cohesion: 0.28
Nodes (3): append(), buildPayload(), handleSync()

### Community 14 - "VturbSyncPanel.tsx (+7)"
Cohesion: 0.29
Nodes (2): append(), handleSync()

### Community 15 - "diagnostics.ts (+6)"
Cohesion: 0.52
Nodes (5): analyzeAccounts(), analyzeRecovery(), buildSuggestions(), extractFamily(), formatBRL()

### Community 16 - "AccountList.tsx (+6)"
Cohesion: 0.29
Nodes (0): 

### Community 17 - "config.ts (+5)"
Cohesion: 0.53
Nodes (4): getMetaProfiles(), getRedtrackApiKey(), getVturbApiToken(), loadSettings()

### Community 18 - "meta-accounts.ts (+5)"
Cohesion: 0.53
Nodes (3): fetchAllPages(), fetchAndSyncMetaAccounts(), fetchBmAdAccounts()

### Community 19 - "usd-brl.ts (+5)"
Cohesion: 0.6
Nodes (5): ensureSchema(), fetchAwesomeApiDaily(), fetchBcbPtax(), getUsdToBrl(), upsertRates()

### Community 20 - "ClientOfertas.tsx (+4)"
Cohesion: 0.4
Nodes (0): 

### Community 21 - "actions.ts (+4)"
Cohesion: 0.4
Nodes (0): 

### Community 22 - "access.ts (+4)"
Cohesion: 0.5
Nodes (2): canAccessPage(), firstAllowedPath()

### Community 23 - "ensureSettingsTable() (+3)"
Cohesion: 0.83
Nodes (3): ensureSettingsTable(), getStoredTokens(), saveApiTokens()

### Community 24 - "meta.ts (+3)"
Cohesion: 0.83
Nodes (3): fetchMetaMetrics(), fetchMetaMetricsPerDay(), resolveMetaToken()

### Community 25 - "redtrack.ts (+3)"
Cohesion: 0.5
Nodes (0): 

### Community 26 - "_helpers.ts (+2)"
Cohesion: 1.0
Nodes (2): loadAccountAuth(), resolveAuth()

### Community 27 - "hoverCache.ts (+2)"
Cohesion: 0.67
Nodes (0): 

### Community 28 - "page.tsx (+2)"
Cohesion: 1.0
Nodes (2): ensureTable(), OfertasPage()

### Community 29 - "RtCampaignSelector.tsx (+2)"
Cohesion: 0.67
Nodes (0): 

### Community 30 - "page.tsx (+2)"
Cohesion: 1.0
Nodes (2): ensureColumns(), StatusContasPage()

### Community 31 - "stale-action.ts (+2)"
Cohesion: 1.0
Nodes (2): handleStaleServerAction(), isStaleServerActionError()

### Community 32 - "test_rt_pag.js (+1)"
Cohesion: 1.0
Nodes (0): 

### Community 33 - "HomeSignOut.tsx (+1)"
Cohesion: 1.0
Nodes (0): 

### Community 34 - "layout.tsx (+1)"
Cohesion: 1.0
Nodes (0): 

### Community 35 - "page.tsx (+1)"
Cohesion: 1.0
Nodes (0): 

### Community 36 - "page.tsx (+1)"
Cohesion: 1.0
Nodes (0): 

### Community 37 - "page.tsx (+1)"
Cohesion: 1.0
Nodes (0): 

### Community 38 - "SessionProvider.tsx (+1)"
Cohesion: 1.0
Nodes (0): 

### Community 39 - "page.tsx (+1)"
Cohesion: 1.0
Nodes (0): 

### Community 40 - "page.tsx (+1)"
Cohesion: 1.0
Nodes (0): 

### Community 41 - "page.tsx (+1)"
Cohesion: 1.0
Nodes (0): 

### Community 42 - "page.tsx (+1)"
Cohesion: 1.0
Nodes (0): 

### Community 43 - "UsersClient.tsx (+1)"
Cohesion: 1.0
Nodes (0): 

### Community 44 - "loadUserAccess() (+1)"
Cohesion: 1.0
Nodes (0): 

### Community 45 - "redtrack-campaigns.ts (+1)"
Cohesion: 1.0
Nodes (0): 

### Community 46 - "auth.ts"
Cohesion: 1.0
Nodes (0): 

### Community 47 - "next-env.d.ts"
Cohesion: 1.0
Nodes (0): 

### Community 48 - "next.config.ts"
Cohesion: 1.0
Nodes (0): 

### Community 49 - "proxy.ts"
Cohesion: 1.0
Nodes (0): 

### Community 50 - "page.tsx"
Cohesion: 1.0
Nodes (0): 

### Community 51 - "route.ts"
Cohesion: 1.0
Nodes (0): 

### Community 52 - "DopScaleLayout.tsx"
Cohesion: 1.0
Nodes (0): 

### Community 53 - "V2MediaLabLayout.tsx"
Cohesion: 1.0
Nodes (0): 

### Community 54 - "page.tsx"
Cohesion: 1.0
Nodes (0): 

### Community 55 - "db.ts"
Cohesion: 1.0
Nodes (0): 

### Community 56 - "supabase.ts"
Cohesion: 1.0
Nodes (0): 

### Community 57 - "types.ts"
Cohesion: 1.0
Nodes (0): 

### Community 58 - "next-auth.d.ts"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **16 isolated node(s):** `node_modules/next/dist/docs/`, `Knowledge Graph First Rule`, `graphify-out/wiki/index.md`, `app/page.tsx Entry Point`, `next/font + Geist` (+11 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `test_rt_pag.js (+1)`** (2 nodes): `test_rt_pag.js`, `run()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `HomeSignOut.tsx (+1)`** (2 nodes): `HomeSignOut.tsx`, `HomeSignOut()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `layout.tsx (+1)`** (2 nodes): `layout.tsx`, `RootLayout()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `page.tsx (+1)`** (2 nodes): `page.tsx`, `AnalisePage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `page.tsx (+1)`** (2 nodes): `page.tsx`, `ApiConfigPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `page.tsx (+1)`** (2 nodes): `page.tsx`, `CampaignsPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `SessionProvider.tsx (+1)`** (2 nodes): `SessionProvider.tsx`, `SessionProvider()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `page.tsx (+1)`** (2 nodes): `page.tsx`, `ImportPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `page.tsx (+1)`** (2 nodes): `page.tsx`, `ImportV2Page()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `page.tsx (+1)`** (2 nodes): `page.tsx`, `SettingsPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `page.tsx (+1)`** (2 nodes): `page.tsx`, `UsersPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `UsersClient.tsx (+1)`** (2 nodes): `UsersClient.tsx`, `run()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `loadUserAccess() (+1)`** (2 nodes): `loadUserAccess()`, `access-server.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `redtrack-campaigns.ts (+1)`** (2 nodes): `redtrack-campaigns.ts`, `fetchAndSyncRedTrackCampaigns()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `auth.ts`** (1 nodes): `auth.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `next-env.d.ts`** (1 nodes): `next-env.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `next.config.ts`** (1 nodes): `next.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `proxy.ts`** (1 nodes): `proxy.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `page.tsx`** (1 nodes): `page.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `route.ts`** (1 nodes): `route.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `DopScaleLayout.tsx`** (1 nodes): `DopScaleLayout.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `V2MediaLabLayout.tsx`** (1 nodes): `V2MediaLabLayout.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `page.tsx`** (1 nodes): `page.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `db.ts`** (1 nodes): `db.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `supabase.ts`** (1 nodes): `supabase.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `types.ts`** (1 nodes): `types.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `next-auth.d.ts`** (1 nodes): `next-auth.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vturbMap (aggregation by campaign_id)` connect `Vturb Session Events (+16)` to `POST /traffic_origin/stats (+19)`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **What connects `node_modules/next/dist/docs/`, `Knowledge Graph First Rule`, `graphify-out/wiki/index.md` to the rest of the system?**
  _16 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `POST() (+31)` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._
- **Should `ClientImport.tsx (+20)` be split into smaller, more focused modules?**
  _Cohesion score 0.11 - nodes in this community are weakly interconnected._
- **Should `ClientCampaignBuilder.tsx (+19)` be split into smaller, more focused modules?**
  _Cohesion score 0.14 - nodes in this community are weakly interconnected._
- **Should `POST /traffic_origin/stats (+19)` be split into smaller, more focused modules?**
  _Cohesion score 0.12 - nodes in this community are weakly interconnected._
- **Should `ClientImportV2.tsx (+18)` be split into smaller, more focused modules?**
  _Cohesion score 0.12 - nodes in this community are weakly interconnected._