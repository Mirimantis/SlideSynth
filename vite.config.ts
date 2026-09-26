import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  root: '.',
  server: {
    port: Number(process.env.PORT) || 5187,
  },
  build: {
    outDir: 'dist',
    // The user manual is its own page (it loads the shortcut table from the
    // command catalog), so it needs building alongside the app.
    rollupOptions: {
      input: { main: 'index.html', help: 'help.html' },
    },
  },
  test: {
    // Agent worktrees live under .claude/worktrees and carry their own copies
    // of the test files — never run those from the main checkout (BACKLOG 14.5).
    exclude: [...configDefaults.exclude, '.claude/**'],
    // Vitest empties stylesheets by default; the theme test (16.7) reads them.
    css: { include: [/styles\/.*\.css/] },
  },
});
