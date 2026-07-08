import { toDatetimeLocal } from './timezone';

/**
 * Builder Snapshot (ver CONTEXT.md → "Builder Snapshot" / "Reopen").
 *
 * Estado do formulário do campaign builder congelado no momento do enqueue e
 * gravado no payload de cada Campaign Job (`payload.builder_snapshot`; todos os
 * jobs de um Broadcast Group carregam o mesmo snapshot). Existe só para o
 * Reopen — "Reabrir no builder" na fila reidrata o formulário com a
 * configuração exata da submissão original. Nunca é aplicado automaticamente e
 * nunca é lido pelo worker.
 *
 * Diferente de um preset (parcial de propósito: só campos genéricos), o
 * snapshot é completo: contas, páginas, criativos com referências de mídia,
 * Creative Groups, templates de nome crus ({{data}} não-resolvido), copy,
 * agendamento. `config` e `shared_copy` são genéricos porque seus tipos
 * concretos (PresetConfig/SharedCopy) vivem no componente do builder — este
 * módulo valida apenas o envelope estrutural.
 *
 * Jobs anteriores a este campo não têm snapshot e não podem ser reabertos
 * (a fila desabilita o botão).
 */

/** Espelho serializável do AdDraft do builder, sem os campos efêmeros de sessão
 *  (image_preview é um object URL de blob — inútil fora da sessão original). */
export interface SnapshotAd {
  id: string;
  name: string;
  image_hash: string;
  video_id: string;
  video_thumbnail_url: string;
  media_kind: 'image' | 'video';
  drive_media?: { file_id: string; filename: string; mime: string };
  upload_filename?: string;
  product_set_id: string;
}

export interface SnapshotSchedule {
  /** datetime-local 'YYYY-MM-DDTHH:mm' no fuso do app (GMT-3). */
  start: string;
  end: string;
  has_end: boolean;
}

export interface BuilderSnapshot<C = unknown, S = unknown> {
  v: 1;
  profile_name: string;
  account_ids: string[];
  page_ids: string[];
  page_allocations: Record<string, number>;
  ads: SnapshotAd[];
  creative_groups: { names: string[]; byId: Record<string, number> };
  shared_copy: S;
  schedule: SnapshotSchedule;
  schedule_video_fill: boolean;
  /** PresetConfig completo do builder (campos genéricos + IDs account-scoped). */
  config: C;
}

/**
 * Guard estrutural do envelope v1. Tolerante a campos extras (forward-compat),
 * estrito no que o Reopen precisa pra reidratar o form sem explodir: versão,
 * perfil, ≥1 conta, ≥1 criativo bem-formado, grupos, agendamento e config.
 */
export function isBuilderSnapshot(x: unknown): x is BuilderSnapshot {
  if (typeof x !== 'object' || x === null) return false;
  const s = x as Record<string, unknown>;
  if (s.v !== 1) return false;
  if (typeof s.profile_name !== 'string') return false;
  if (!isStringArray(s.account_ids) || s.account_ids.length === 0) return false;
  if (!isStringArray(s.page_ids)) return false;
  if (typeof s.page_allocations !== 'object' || s.page_allocations === null) return false;
  if (!Array.isArray(s.ads) || s.ads.length === 0) return false;
  for (const ad of s.ads) {
    if (typeof ad !== 'object' || ad === null) return false;
    const a = ad as Record<string, unknown>;
    if (typeof a.id !== 'string' || typeof a.name !== 'string') return false;
  }
  const g = s.creative_groups as Record<string, unknown> | null;
  if (typeof g !== 'object' || g === null) return false;
  if (!isStringArray(g.names)) return false;
  if (typeof g.byId !== 'object' || g.byId === null) return false;
  const sched = s.schedule as Record<string, unknown> | null;
  if (typeof sched !== 'object' || sched === null) return false;
  if (typeof sched.start !== 'string') return false;
  if (typeof s.config !== 'object' || s.config === null) return false;
  return true;
}

function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((v) => typeof v === 'string');
}

/**
 * Recalcula o agendamento de um snapshot ao Reopen: datas ainda no futuro são
 * mantidas exatas; início no passado (ou vazio — a Meta rejeita início
 * não-futuro) volta ao default do builder (agora + 1h no fuso do app) e término
 * no passado é limpo. Comparação lexicográfica funciona no formato
 * datetime-local de largura fixa.
 */
export function reopenSchedule(s: SnapshotSchedule, now: Date = new Date()): SnapshotSchedule {
  const nowLocal = toDatetimeLocal(now);
  const start =
    s.start && s.start > nowLocal
      ? s.start
      : toDatetimeLocal(new Date(now.getTime() + 60 * 60 * 1000));
  const keepEnd = s.has_end && !!s.end && s.end > nowLocal;
  return { start, end: keepEnd ? s.end : '', has_end: keepEnd };
}
