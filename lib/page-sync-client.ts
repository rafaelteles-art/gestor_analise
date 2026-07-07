/**
 * Client-side helper do sync de páginas por perfil: enfileira o job
 * (POST /api/pages/sync) e faz poll até terminar. O Cloud Scheduler pode levar
 * até ~2 min para pegar o job — o poll é paciente por design ("async, walk away").
 * fetch/sleep são injetáveis para teste.
 */
export interface PageSyncProgress {
  message: string;
  current: number;
  total: number;
  indeterminate: boolean;
}

export async function runPageSyncJob(opts: {
  profiles?: string[];
  onProgress?: (p: PageSyncProgress) => void;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  pollMs?: number;
} = {}): Promise<{ partial: boolean }> {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleepImpl ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollMs = opts.pollMs ?? 2500;

  const res = await doFetch('/api/pages/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts.profiles && opts.profiles.length ? { profiles: opts.profiles } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || !data.job_id) throw new Error(String(data.error ?? `HTTP ${res.status}`));
  const jobId = data.job_id as number;

  while (true) {
    await sleep(pollMs);
    let job: Record<string, unknown>;
    try {
      const st = await doFetch(`/api/pages/sync/status?job_id=${jobId}`);
      job = (await st.json()) as Record<string, unknown>;
      if (!st.ok) throw new Error(String(job.error ?? `HTTP ${st.status}`));
    } catch {
      continue; // transitório — segue tentando
    }
    opts.onProgress?.({
      message: typeof job.message === 'string' ? job.message : 'Processando…',
      current: typeof job.current === 'number' ? job.current : 0,
      total: typeof job.total === 'number' ? job.total : 0,
      indeterminate: !job.total,
    });
    if (job.status === 'done') return { partial: job.partial === true };
    if (job.status === 'error') throw new Error(typeof job.error === 'string' ? job.error : 'erro desconhecido');
  }
}
