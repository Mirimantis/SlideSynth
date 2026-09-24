/**
 * Key chords for the command registry (BACKLOG 15.3): "Ctrl+Shift+Z",
 * "Alt+S", "Space", "?". Parsing, matching against a keyboard event, and
 * display text. Pure, so the whole binding policy is testable.
 */

export interface KeyChord {
  /** A lowercase letter, a printable symbol ("?"), or a KeyboardEvent.key name
   *  ("Escape", "PageUp", " " for Space). */
  key: string;
  /** Ctrl, or Cmd on macOS. */
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

/** The KeyboardEvent fields matching reads. */
export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

const KEY_ALIASES: Readonly<Record<string, string>> = { Space: ' ', Esc: 'Escape', Del: 'Delete' };
const KEY_DISPLAY: Readonly<Record<string, string>> = { ' ': 'Space', PageUp: 'Page Up', PageDown: 'Page Down' };

export function parseChord(text: string): KeyChord {
  const parts = text.split('+');
  const raw = parts.pop()!;
  const mods = new Set(parts);
  for (const m of mods) {
    if (m !== 'Ctrl' && m !== 'Shift' && m !== 'Alt') throw new Error(`Unknown modifier "${m}" in "${text}"`);
  }
  const named = KEY_ALIASES[raw] ?? raw;
  return {
    key: /^[A-Za-z]$/.test(named) ? named.toLowerCase() : named,
    ctrl: mods.has('Ctrl'),
    shift: mods.has('Shift'),
    alt: mods.has('Alt'),
  };
}

/**
 * Whether a key event is this chord. Ctrl (or Cmd) and Alt must match exactly.
 * - Letters match the typed letter, so a binding follows the printed key on
 *   any layout, and Shift must match. When Alt or a dead key turns the letter
 *   into another character (macOS Option+S is "ß"), the physical key is used.
 * - Symbols such as "?" and "!" need Shift on most layouts, so Shift isn't
 *   part of their chord.
 * - Named keys (Space, Escape, Delete, Page Up, …) need Shift to match.
 */
export function chordMatches(chord: KeyChord, e: KeyLike): boolean {
  if ((e.ctrlKey || e.metaKey) !== chord.ctrl || e.altKey !== chord.alt) return false;
  if (/^[a-z]$/.test(chord.key)) {
    if (e.shiftKey !== chord.shift) return false;
    return /^[A-Za-z]$/.test(e.key)
      ? e.key.toLowerCase() === chord.key
      : e.code === `Key${chord.key.toUpperCase()}`;
  }
  if (chord.key.length === 1 && chord.key !== ' ') return e.key === chord.key;
  return e.shiftKey === chord.shift && e.key === chord.key;
}

/** Display text: "Ctrl+Shift+Z", "Space", "Page Up", "?". */
export function formatChord(chord: KeyChord): string {
  const key = KEY_DISPLAY[chord.key] ?? (chord.key.length === 1 ? chord.key.toUpperCase() : chord.key);
  return [chord.ctrl && 'Ctrl', chord.alt && 'Alt', chord.shift && 'Shift', key].filter(Boolean).join('+');
}
