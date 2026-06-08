/**
 * Batch-normalize every icon under src/assets/icons/ in place.
 *
 * Drop SVGs exported from any tool (Graphite, Inkscape, Illustrator, …) into
 * that folder, then run:  npm run icons
 *
 * Each file is rewritten through the shared normalizer so colors become
 * `currentColor` and editor cruft / opaque backgrounds are stripped. Files that
 * are already clean are left untouched. The transform is idempotent, so it is
 * safe to re-run any time.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeSvg } from '../src/utils/svg-normalize.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '..', 'src', 'assets', 'icons');

const files = readdirSync(iconsDir).filter((f) => f.toLowerCase().endsWith('.svg'));

let changed = 0;
let unchanged = 0;

for (const file of files) {
  const path = join(iconsDir, file);
  const before = readFileSync(path, 'utf8');
  // Preserve the file's existing line-ending style so we don't churn EOLs
  // (and report false "changed") on CRLF checkouts.
  const eol = before.includes('\r\n') ? '\r\n' : '\n';
  const after = normalizeSvg(before).replace(/\n/g, eol);
  if (after === before) {
    unchanged += 1;
    console.log(`  · ${file}  (already clean)`);
    continue;
  }
  writeFileSync(path, after, 'utf8');
  changed += 1;
  const droppedBg = /fill\s*=\s*"#|fill\s*:\s*#/i.test(before) && !/#/.test(after);
  const notes = [];
  if (/currentColor/i.test(after) && !/currentColor/i.test(before)) notes.push('colors → currentColor');
  if (/<rect[^>]*\bwidth\s*=\s*"(?:24|100%)/.test(before) && !/<rect/.test(after)) notes.push('stripped bg rect');
  if (/xmlns:(inkscape|sodipodi|graphite)/i.test(before)) notes.push('stripped editor metadata');
  console.log(`  ✓ ${file}  ${notes.length ? '(' + notes.join(', ') + ')' : ''}`);
}

console.log(`\n${changed} normalized, ${unchanged} already clean.`);
