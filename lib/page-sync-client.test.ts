import { describe, it, expect, vi } from 'vitest';
import { runPageSyncJob } from './page-sync-client';

type Json = Record<string, unknown>;
function jsonRes(body: Json, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}
const noSleep = () => Promise.resolve();

describe('runPageSyncJob', () => {
  it('enfileira, faz poll até done e resolve com partial=false', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonRes({ job_id: 7 }))
      .mockResolvedValueOnce(jsonRes({ status: 'running', message: 'Perfil P1', current: 1, total: 3 }))
      .mockResolvedValueOnce(jsonRes({ status: 'done', partial: false }));
    const progress: unknown[] = [];
    const out = await runPageSyncJob({
      profiles: ['P1'],
      onProgress: (p) => progress.push(p),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });
    expect(out).toEqual({ partial: false });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/pages/sync');
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string)).toEqual({ profiles: ['P1'] });
    expect(fetchImpl.mock.calls[1][0]).toBe('/api/pages/sync/status?job_id=7');
    // onProgress dispara em todo tick de poll, inclusive no tick 'done' (paridade
    // com o comportamento atual do /paginas).
    expect(progress[0]).toEqual({ message: 'Perfil P1', current: 1, total: 3, indeterminate: false });
    expect(progress[1]).toEqual({ message: 'Processando…', current: 0, total: 0, indeterminate: true });
  });

  it('propaga partial=true e manda body {} sem profiles (= todos os perfis)', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonRes({ job_id: 1 }))
      .mockResolvedValueOnce(jsonRes({ status: 'done', partial: true }));
    const out = await runPageSyncJob({ fetchImpl: fetchImpl as unknown as typeof fetch, sleepImpl: noSleep });
    expect(out).toEqual({ partial: true });
    expect(JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string)).toEqual({});
  });

  it('lança quando o enqueue falha', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonRes({ error: 'sem token' }, false, 500));
    await expect(runPageSyncJob({ fetchImpl: fetchImpl as unknown as typeof fetch, sleepImpl: noSleep }))
      .rejects.toThrow('sem token');
  });

  it('lança quando o job termina em error', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonRes({ job_id: 2 }))
      .mockResolvedValueOnce(jsonRes({ status: 'error', error: 'rate limit' }));
    await expect(runPageSyncJob({ fetchImpl: fetchImpl as unknown as typeof fetch, sleepImpl: noSleep }))
      .rejects.toThrow('rate limit');
  });

  it('tolera falha transitória de rede no poll e continua', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonRes({ job_id: 3 }))
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(jsonRes({ status: 'done', partial: false }));
    const out = await runPageSyncJob({ fetchImpl: fetchImpl as unknown as typeof fetch, sleepImpl: noSleep });
    expect(out).toEqual({ partial: false });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
