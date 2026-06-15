// Shared contract between the campaign queue worker (lib/campaign-jobs.ts) and the
// batch orchestrator (lib/meta-campaigns.ts). Spec: docs/superpowers/plans/
// 2026-06-11-campaign-builder-features.md (Contracts 1 & 2) + docs/adr/0005.

export type SeparationLevel = 'campaign' | 'adset' | 'ad';

// Entity-key grammar (deterministic, enables idempotent resume):
//   c:<creativeIdx>:<campIdx> | s:<cr>:<ci>:<adsetIdx> | a:<cr>:<ci>:<si>:<adIdx>
// Shared entities (separation 'adset'/'ad') use '-' for the creative segment, e.g. c:-:0.
// Media upload checkpoints use m:<creativeIdx>.
export type BatchRunState = {
  created: Record<string, string>; // entityKey -> Meta entity id (skip create, reuse id)
  failed: Record<string, string>;  // entityKey -> error message (descendants are skipped)
};

export type BatchEvent =
  | { kind: 'created'; key: string; entity: 'campaign' | 'adset' | 'ad'; name: string; id: string }
  | { kind: 'failed'; key: string; entity: 'campaign' | 'adset' | 'ad'; name: string; error: string; permanent: boolean }
  | { kind: 'skipped'; key: string; reason: string };

export type BatchRunOpts = {
  onEvent: (e: BatchEvent) => Promise<void>; // worker persists checkpoint + extends lease
  runState: BatchRunState;                   // {created:{},failed:{}} on first run
  shouldAbort: () => boolean;                // true near time budget or cancel_requested
};

export type BatchRunResult = {
  aborted: boolean;
  counts: { created: number; failed: number; skipped: number };
};

// Worker-side view of createCampaignBatch until wave-1 integration unifies signatures.
export type CreateCampaignBatchFn = (input: any, opts: BatchRunOpts) => Promise<BatchRunResult>;

export type CreativeMedia =
  | { source: 'meta'; image_hash?: string; video_id?: string; video_thumbnail_url?: string; filename: string }
  | { source: 'drive'; file_id: string; filename: string; mime: string };
