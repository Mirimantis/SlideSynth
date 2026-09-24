import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  root: '.',
  server: {
    port: Number(process.env.PORT) || 5187,
  },
  build: {
    outDir: 'dist',
  },
  test: {
    // Agent worktrees live under .claude/worktrees and carry their own copies
    // of the test files — never run those from the main checkout (BACKLOG 14.5).
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
});
