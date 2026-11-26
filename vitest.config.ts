import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/server', 'apps/desktop', { test: { name: 'scripts', include: ['scripts/**/*.test.mjs'] } }],
  },
});
