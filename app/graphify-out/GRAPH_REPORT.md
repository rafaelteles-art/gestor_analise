# Graph Report - .  (2026-06-24)

## Corpus Check
- 111 files · ~98,886 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 382 nodes · 404 edges · 57 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
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

## God Nodes (most connected - your core abstractions)
1. `POST()` - 45 edges
2. `GET()` - 34 edges
3. `DELETE()` - 7 edges
4. `loadVideoData()` - 5 edges
5. `analyzeRecovery()` - 4 edges
6. `PATCH()` - 4 edges
7. `ensureTable()` - 4 edges
8. `applyPicker()` - 4 edges
9. `requireAdmin()` - 4 edges
10. `extractFamily()` - 3 edges

## Surprising Connections (you probably didn't know these)
- `handle()` --calls--> `GET()`  [EXTRACTED]
  api\campaigns\businesses\route.ts → api\status-contas\sync\route.ts
- `handleGet()` --calls--> `GET()`  [EXTRACTED]
  api\campaigns\catalogs\route.ts → api\status-contas\sync\route.ts
- `POST()` --calls--> `ensureTable()`  [EXTRACTED]
  api\vturb\sync-players\route.ts → api\ofertas\route.ts
- `POST()` --calls--> `sanitizeItems()`  [EXTRACTED]
  api\vturb\sync-players\route.ts → api\catalogs\conjunto-sessions\route.ts
- `POST()` --calls--> `validateConfig()`  [EXTRACTED]
  api\vturb\sync-players\route.ts → api\catalogs\product-presets\route.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (11): aggregateByKey(), combineDailyRtAd(), combineDailyRtCamp(), combineDailyRtCampById(), ensureSchema(), ensureVturbTable(), parseDateInput(), POST() (+3 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (8): DELETE(), ensureColumns(), ensureTable(), GET(), getPublicBaseUrl(), handle(), handleGet(), PATCH()

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (9): applyAccountScopedPreset(), applyPresetConfig(), buildCurrentPresetConfig(), emptyAd(), handleApplyPreset(), handleSavePreset(), handleSingleUpload(), makeId() (+1 more)

### Community 3 - "Community 3"
Cohesion: 0.08
Nodes (7): closeCreateCatalogModal(), handleCommitImport(), handleCreateCatalog(), handleUnignoreProduct(), handleVideoSync(), loadVideoData(), openVideoModal()

### Community 4 - "Community 4"
Cohesion: 0.12
Nodes (2): handleImport(), handleSyncToday()

### Community 5 - "Community 5"
Cohesion: 0.14
Nodes (2): handleImport(), handleSyncToday()

### Community 6 - "Community 6"
Cohesion: 0.16
Nodes (5): commit(), handleKeyDown(), handleSync(), handleSyncStatus(), runStreamedSync()

### Community 7 - "Community 7"
Cohesion: 0.21
Nodes (4): applyPicker(), commitAccountLink(), commitLink(), ofertaName()

### Community 8 - "Community 8"
Cohesion: 0.22
Nodes (2): countActiveSets(), isActive()

### Community 9 - "Community 9"
Cohesion: 0.36
Nodes (9): createUser(), deleteUser(), isValidEmail(), isValidPageKey(), requireAdmin(), requireSuperAdmin(), setUserPageAccess(), togglePageAccess() (+1 more)

### Community 10 - "Community 10"
Cohesion: 0.22
Nodes (0): 

### Community 11 - "Community 11"
Cohesion: 0.22
Nodes (0): 

### Community 12 - "Community 12"
Cohesion: 0.25
Nodes (0): 

### Community 13 - "Community 13"
Cohesion: 0.32
Nodes (3): handleSync(), runPolledSync(), sleep()

### Community 14 - "Community 14"
Cohesion: 0.32
Nodes (3): append(), buildPayload(), handleSync()

### Community 15 - "Community 15"
Cohesion: 0.29
Nodes (2): append(), handleSync()

### Community 16 - "Community 16"
Cohesion: 0.52
Nodes (5): analyzeAccounts(), analyzeRecovery(), buildSuggestions(), extractFamily(), formatBRL()

### Community 17 - "Community 17"
Cohesion: 0.33
Nodes (2): kick(), tickAndPoll()

### Community 18 - "Community 18"
Cohesion: 0.29
Nodes (0): 

### Community 19 - "Community 19"
Cohesion: 0.33
Nodes (0): 

### Community 20 - "Community 20"
Cohesion: 0.4
Nodes (0): 

### Community 21 - "Community 21"
Cohesion: 0.83
Nodes (3): ensureSettingsTable(), getStoredTokens(), saveApiTokens()

### Community 22 - "Community 22"
Cohesion: 0.83
Nodes (3): cacheKey(), preloadHistoryBatch(), rtCampaignSetKey()

### Community 23 - "Community 23"
Cohesion: 0.5
Nodes (0): 

### Community 24 - "Community 24"
Cohesion: 1.0
Nodes (2): ConsoleClock(), partsInAppTz()

### Community 25 - "Community 25"
Cohesion: 1.0
Nodes (2): loadAccountAuth(), resolveAuth()

### Community 26 - "Community 26"
Cohesion: 0.67
Nodes (0): 

### Community 27 - "Community 27"
Cohesion: 0.67
Nodes (0): 

### Community 28 - "Community 28"
Cohesion: 1.0
Nodes (2): ensureTable(), PaginasPage()

### Community 29 - "Community 29"
Cohesion: 0.67
Nodes (0): 

### Community 30 - "Community 30"
Cohesion: 1.0
Nodes (2): ensureBlacklistSchema(), SettingsPage()

### Community 31 - "Community 31"
Cohesion: 1.0
Nodes (2): ensureColumns(), StatusContasPage()

### Community 32 - "Community 32"
Cohesion: 1.0
Nodes (0): 

### Community 33 - "Community 33"
Cohesion: 1.0
Nodes (0): 

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

## Knowledge Gaps
- **Thin community `Community 32`** (2 nodes): `HomeSignOut()`, `HomeSignOut.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (2 nodes): `RootLayout()`, `layout.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (2 nodes): `page.tsx`, `AnalisePage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (2 nodes): `page.tsx`, `ApiConfigPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (2 nodes): `page.tsx`, `CampaignsPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (2 nodes): `page.tsx`, `FilaPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (2 nodes): `page.tsx`, `CatalogoPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (2 nodes): `OfferSelector.tsx`, `OfferSelector()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (2 nodes): `SessionProvider.tsx`, `SessionProvider()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (2 nodes): `ThemeToggle.tsx`, `ThemeToggle()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (2 nodes): `page.tsx`, `DataStudioPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (2 nodes): `page.tsx`, `ImportPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (2 nodes): `page.tsx`, `ImportV2Page()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (2 nodes): `AccountStatusBadge()`, `accountStatus.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (2 nodes): `page.tsx`, `OfertasPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (2 nodes): `page.tsx`, `OverviewPage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (2 nodes): `UsersPage()`, `page.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (2 nodes): `UsersClient.tsx`, `run()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (1 nodes): `page.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (1 nodes): `route.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (1 nodes): `DopScaleLayout.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (1 nodes): `V2MediaLabLayout.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (1 nodes): `reactSelectStyles.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (1 nodes): `theme.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (1 nodes): `page.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `POST()` connect `Community 0` to `Community 1`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Why does `GET()` connect `Community 1` to `Community 0`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.12 - nodes in this community are weakly interconnected._