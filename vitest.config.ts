import { defineConfig } from 'vitest/config';

// Pure-logic tests only. DB/Graph code is verified via curl + SQL, not here.
export default defineConfig({
  test: {
    include: ['lib/**/*.test.ts'],
    environment: 'node',
  },
});
