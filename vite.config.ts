import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig, configDefaults } from 'vitest/config';

/** Which build this is (13.28): version, commit (+ when there were
 *  uncommitted changes) and date, shown in Settings so testers can say which
 *  build they used. */
function buildInfo(): string {
  const version = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;
  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD').toString().trim();
    if (execSync('git status --porcelain --untracked-files=no').toString().trim() !== '') commit += '+';
  } catch {
    // Not a git checkout: leave it unknown.
  }
  return `${version} · ${commit} · ${new Date().toISOString().slice(0, 10)}`;
}

export default defineConfig({
  root: '.',
  define: {
    __BUILD_INFO__: JSON.stringify(buildInfo()),
  },
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
