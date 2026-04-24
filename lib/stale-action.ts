// Quando um deploy novo é publicado enquanto o user está com a aba aberta,
// os IDs hash das Server Actions no bundle JS do browser deixam de existir no
// servidor e o Next.js lança "Server Action ... was not found on the server".
// Este helper detecta esse erro específico e recarrega a página para baixar o
// bundle atualizado.

const STALE_ACTION_PATTERNS = [
  /Server Action ".*" was not found on the server/i,
  /failed to find server action/i,
];

export function isStaleServerActionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return STALE_ACTION_PATTERNS.some((p) => p.test(msg));
}

export function handleStaleServerAction(err: unknown): boolean {
  if (!isStaleServerActionError(err)) return false;
  if (typeof window !== 'undefined') {
    window.location.reload();
  }
  return true;
}
