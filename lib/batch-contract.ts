// Shared contract between the campaign queue worker (lib/campaign-jobs.ts) and the
// batch orchestrator (lib/meta-campaigns.ts). Spec: docs/superpowers/plans/
// 2026-06-11-campaign-builder-features.md (Contracts 1 & 2) + docs/adr/0005.

export type SeparationLevel = 'campaign' | 'adset' | 'ad' | 'group';

// Entity-key grammar (deterministic, enables idempotent resume):
//   c:<creativeIdx>:<campIdx> | s:<cr>:<ci>:<adsetIdx> | a:<cr>:<ci>:<si>:<adIdx>
// Shared entities (separation 'adset'/'ad'/'group') use '-' for the creative segment, e.g. c:-:0.
// Group-level adsets (ADR-0009) belong to a Creative Group, not a creative: s:g<groupIdx>:<ci>:<si>
// (<si> is the adset index WITHIN the group; ad keys stay a:<cr>:<ci>:<si>:<ai>, unique because
// each creative lives in exactly one group).
// Media upload checkpoints use m:<creativeIdx>.
export type BatchRunState = {
  created: Record<string, string>; // entityKey -> Meta entity id (skip create, reuse id)
  failed: Record<string, string>;  // entityKey -> error message (descendants are skipped)
  // entityKey -> true quando a chave JÁ consumiu seu único retry-de-resume
  // (Contract 1, retry-then-skip). Opcional: jobs anteriores a este campo não o
  // têm no JSONB — claimResumeRetry() cria o mapa sob demanda.
  retried?: Record<string, true>;
};

/**
 * Contract 1 — retry-then-skip de verdade. Decide se uma chave deve ser TENTADA
 * neste run ou pulada em silêncio:
 *
 * - nunca falhou            → tenta (primeira tentativa, não consome retry);
 * - falhou e sem marca      → tenta UMA última vez e marca retried[key] (o
 *                             marker persiste via run_state no próximo checkpoint);
 * - falhou e já marcada     → false: pula em silêncio (sem evento, sem counts —
 *                             a chave continua contada como failed via run_state).
 *
 * Sem o marker, cada tick de resume re-tentava TODAS as falhas permanentes de
 * novo: um job com ~900 falhas de pixel re-emitia ~900 eventos `failed` por tick
 * e nunca fechava a passada dentro do budget de 270s — loop infinito de ~9h que
 * inflou events a 19MB/job e derrubou a fila (resposta da lista > 32MB → corte
 * do LB → JSON inválido no cliente).
 */
export function claimResumeRetry(runState: BatchRunState, key: string): boolean {
  if (!runState.failed[key]) return true;
  const retried = (runState.retried ??= {});
  if (retried[key]) return false;
  retried[key] = true;
  return true;
}

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
