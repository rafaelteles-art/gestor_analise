import { defineConfig } from 'vitest/config';

// Pure-logic tests only. DB/Graph code is verified via curl + SQL, not here.
// DATABASE_URL is injected so importing modules that transitively import lib/db.ts
// (which throws at load time without it) doesn't crash test collection. The pg Pool
// is constructed lazily and never actually connects during these pure-logic tests.
export default defineConfig({
  test: {
    include: ['lib/**/*.test.ts', 'app/lib/**/*.test.ts'],
    environment: 'node',
    env: { DATABASE_URL: 'postgres://test:test@localhost:5432/test' },
  },
});
