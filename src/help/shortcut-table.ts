import { COMMAND_SPECS, GESTURES, shortcutText, type CommandSection } from '../commands/catalog';

/**
 * The help page's Keyboard Shortcuts table, generated from the command
 * catalog (BACKLOG 15.3) so it can't fall out of step with the real bindings.
 */

const SECTION_ORDER: readonly CommandSection[] = ['Transport', 'Perform', 'Tools', 'Edit', 'Harmonic Prism', 'View'];

function kbd(text: string): string {
  // "Ctrl+Shift+Z / Ctrl+Y" → <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd>
  return text.split(' / ').map(chord =>
    chord.split('+').map(k => `<kbd>${escape(k)}</kbd>`).join('+'),
  ).join(' / ');
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function row(keys: string, action: string): string {
  return `<tr><td>${keys}</td><td>${escape(action)}</td></tr>`;
}

export function shortcutTableHtml(): string {
  const rows: string[] = ['<tr><th>Key</th><th>Action</th></tr>'];
  for (const section of SECTION_ORDER) {
    const bound = COMMAND_SPECS.filter(c => c.section === section && c.keys?.length);
    if (bound.length === 0) continue;
    rows.push(`<tr class="shortcut-section"><th colspan="2">${escape(section)}</th></tr>`);
    for (const c of bound) {
      rows.push(row(kbd(shortcutText(c.id)), c.description ? `${c.label} — ${c.description}` : c.label));
    }
  }
  rows.push('<tr class="shortcut-section"><th colspan="2">Mouse</th></tr>');
  for (const g of GESTURES) rows.push(row(escape(g.keys), g.action));
  return rows.join('\n');
}

const table = document.getElementById('shortcut-table');
if (table) table.innerHTML = shortcutTableHtml();
