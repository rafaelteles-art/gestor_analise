import { describe, it, expect } from 'vitest';
// Núcleo puro do Scheduled Video Fill (docs/adr/0010): cômputo do horário de
// disparo (âncora 08:30 vs. hora+N) e a transação de arm com dedup status-aware
// (1 pendente por catálogo+dia, re-ancora para o mais cedo, done não bloqueia).
// Segue o padrão de campaign-jobs-core: lógica testável sem banco, o módulo com
// pool delega para cá.
import {
  computeFillTiming,
  runArmVideoFill,
  LEGACY_UNIQ_DROP_SQL,
  PENDING_UNIQ_INDEX_SQL,
  type ArmQueryClient,
} from '../catalog-video-fills-core';

// 15:00 GMT-3 de um dia fixo — determinístico em qualquer TZ de máquina.
const NOW = new Date('2026-07-09T15:00:00-03:00');

describe('computeFillTiming — âncora vs. hora+N', () => {
  it('null → próxima 08:30 GMT-3 (âncora do ADR-0008, inalterada)', () => {
    const r = computeFillTiming(NOW, null);
    expect(r.fireDate).toBe('2026-07-10');
    expect(r.fireAt.getTime()).toBe(new Date('2026-07-10T08:30:00-03:00').getTime());
  });

  it('N=2 → criação + 2h, fire_date no fuso do app', () => {
    const r = computeFillTiming(NOW, 2);
    expect(r.fireAt.getTime()).toBe(new Date('2026-07-09T17:00:00-03:00').getTime());
    expect(r.fireDate).toBe('2026-07-09');
  });

  it('N=0 → "o quanto antes": dispara no instante do arm (próximo tick do poller)', () => {
    const r = computeFillTiming(NOW, 0);
    expect(r.fireAt.getTime()).toBe(NOW.getTime());
    expect(r.fireDate).toBe('2026-07-09');
  });

  it('N atravessando a meia-noite cai no dia seguinte (fire_date GMT-3)', () => {
    const late = new Date('2026-07-09T22:00:00-03:00');
    const r = computeFillTiming(late, 4);
    expect(r.fireAt.getTime()).toBe(new Date('2026-07-10T02:00:00-03:00').getTime());
    expect(r.fireDate).toBe('2026-07-10');
  });

  it('rejeita N fora de 0–24 ou não-inteiro', () => {
    expect(() => computeFillTiming(NOW, -1)).toThrow();
    expect(() => computeFillTiming(NOW, 25)).toThrow();
    expect(() => computeFillTiming(NOW, 1.5)).toThrow();
    expect(() => computeFillTiming(NOW, Number.NaN)).toThrow();
  });
});

describe('schema — unicidade parcial (docs/adr/0010)', () => {
  it('o índice novo é ÚNICO, parcial em pending, sobre (catalog_id, fire_date)', () => {
    const sql = PENDING_UNIQ_INDEX_SQL.replace(/\s+/g, ' ');
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS/i);
    expect(sql).toMatch(/\(catalog_id, fire_date\)/);
    expect(sql).toMatch(/WHERE status = 'pending'/);
  });

  it('a constraint legada (bloqueava inclusive done) é derrubada com IF EXISTS', () => {
    const sql = LEGACY_UNIQ_DROP_SQL.replace(/\s+/g, ' ');
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS catalog_video_fills_catalog_id_fire_date_key/i);
  });
});

// ── runArmVideoFill: fake client roteirizado ────────────────────────────────
type Call = { sql: string; values: unknown[] };

function scriptedClient(script: Array<{ rows: unknown[] }>): ArmQueryClient & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    async query(sql: string, values: unknown[] = []) {
      calls.push({ sql: sql.replace(/\s+/g, ' '), values });
      const next = script.shift();
      if (!next) throw new Error('unexpected extra query: ' + sql);
      return { rows: next.rows as any[] };
    },
  };
}

const PARAMS = {
  catalogId: 'cat1',
  catalogName: 'Catálogo 1',
  armedBy: 'op@x.com',
  fireAt: new Date('2026-07-09T17:00:00-03:00'),
  fireDate: '2026-07-09',
};

const rowAt = (iso: string, extra: Record<string, unknown> = {}) => ({
  id: 7,
  catalog_id: 'cat1',
  fire_date: '2026-07-09',
  fire_at: new Date(iso).toISOString(),
  status: 'pending',
  ...extra,
});

describe('runArmVideoFill — dedup status-aware + re-ancoragem', () => {
  it('sem pendente no dia → INSERT cria o fill (armed, não re-ancorado)', async () => {
    const fill = rowAt('2026-07-09T17:00:00-03:00');
    const client = scriptedClient([{ rows: [fill] }]);
    const r = await runArmVideoFill(client, PARAMS);
    expect(r).toEqual({ armed: true, reanchored: false, fill });
    // O arbiter do INSERT precisa casar com o índice parcial: só pendentes conflitam.
    expect(client.calls[0].sql).toMatch(/ON CONFLICT \(catalog_id, fire_date\) WHERE status = 'pending' DO NOTHING/i);
  });

  it('pendente mais tarde no mesmo dia → re-ancora para o horário mais cedo', async () => {
    const moved = rowAt('2026-07-09T17:00:00-03:00');
    const client = scriptedClient([
      { rows: [] },      // INSERT conflita (já há pendente hoje)
      { rows: [moved] }, // UPDATE re-ancora (fire_at > novo)
    ]);
    const r = await runArmVideoFill(client, PARAMS);
    expect(r).toEqual({ armed: true, reanchored: true, fill: moved });
    // Só move para MAIS CEDO — nunca adia um pendente.
    expect(client.calls[1].sql).toMatch(/status = 'pending'/);
    expect(client.calls[1].sql).toMatch(/fire_at > /);
  });

  it('pendente mais cedo (ou igual) → no-op: devolve o existente sem mover', async () => {
    const existing = rowAt('2026-07-09T16:00:00-03:00');
    const client = scriptedClient([
      { rows: [] },        // INSERT conflita
      { rows: [] },        // UPDATE não acha nada mais tarde
      { rows: [existing] } // SELECT do pendente vigente
    ]);
    const r = await runArmVideoFill(client, PARAMS);
    expect(r).toEqual({ armed: false, reanchored: false, fill: existing });
  });

  it('corrida: pendente sumiu entre as queries (claimed/cancelado) → re-tenta o INSERT', async () => {
    const fill = rowAt('2026-07-09T17:00:00-03:00');
    const client = scriptedClient([
      { rows: [] },     // INSERT conflita com um pendente…
      { rows: [] },     // …que foi claimed antes do UPDATE
      { rows: [] },     // SELECT também não acha pendente
      { rows: [fill] }, // segunda volta: INSERT agora passa
    ]);
    const r = await runArmVideoFill(client, PARAMS);
    expect(r).toEqual({ armed: true, reanchored: false, fill });
  });

  it('corrida patológica sem convergir → lança em vez de loop infinito', async () => {
    const empty = { rows: [] as unknown[] };
    const client = scriptedClient(Array(12).fill(empty));
    await expect(runArmVideoFill(client, PARAMS)).rejects.toThrow();
  });
});
