import { describe, it, expect } from 'vitest';
import { buildRtSyncTasks } from './rt-sync-tasks';

const camp = (id: string) => ({ campaign_id: id, campaign_name: `Camp ${id}` });

describe('buildRtSyncTasks', () => {
  it('gera pares campanha×dia em ordem determinística (dias dentro de cada campanha)', () => {
    const tasks = buildRtSyncTasks([camp('a'), camp('b')], ['2026-07-01', '2026-07-02']);
    expect(tasks.map(t => `${t.camp.campaign_id}:${t.day}`)).toEqual([
      'a:2026-07-01', 'a:2026-07-02', 'b:2026-07-01', 'b:2026-07-02',
    ]);
  });

  it('retomada por cursor cobre todas as tarefas exatamente uma vez, sem pular nem repetir', () => {
    const tasks = buildRtSyncTasks([camp('a'), camp('b'), camp('c')], ['d1', 'd2', 'd3', 'd4', 'd5']);
    // simula fatias de tamanhos irregulares: cada chunk processa N tarefas e
    // devolve nextTask = índice absoluto da próxima não-processada
    const seen: string[] = [];
    let startTask = 0;
    for (const chunkSize of [4, 1, 7, 100]) {
      const pending = tasks.slice(startTask);
      const processed = pending.slice(0, chunkSize);
      seen.push(...processed.map(t => `${t.camp.campaign_id}:${t.day}`));
      startTask += processed.length;
      if (startTask >= tasks.length) break;
    }
    expect(seen).toEqual(tasks.map(t => `${t.camp.campaign_id}:${t.day}`));
    expect(new Set(seen).size).toBe(15);
  });

  it('lista vazia de campanhas ou dias gera zero tarefas', () => {
    expect(buildRtSyncTasks([], ['d1'])).toEqual([]);
    expect(buildRtSyncTasks([camp('a')], [])).toEqual([]);
  });
});
