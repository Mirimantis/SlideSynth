import { describe, it, expect } from 'vitest';
import { parseChord, chordMatches, formatChord, type KeyLike } from './keys';
import { COMMAND_SPECS, commandTitle, shortcutText } from './catalog';
import { commandForKey } from './registry';

function key(k: string, code: string, mods: Partial<Pick<KeyLike, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>> = {}): KeyLike {
  return { key: k, code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods };
}

describe('key chords (BACKLOG 15.3)', () => {
  it('parses modifiers and normalises keys', () => {
    expect(parseChord('Ctrl+Shift+Z')).toEqual({ key: 'z', ctrl: true, shift: true, alt: false });
    expect(parseChord('Space').key).toBe(' ');
    expect(parseChord('PageUp').key).toBe('PageUp');
    expect(() => parseChord('Hyper+Q')).toThrow();
  });

  it('letters match the typed letter with exact modifiers; Cmd counts as Ctrl', () => {
    const z = parseChord('Ctrl+Z');
    expect(chordMatches(z, key('z', 'KeyZ', { ctrlKey: true }))).toBe(true);
    expect(chordMatches(z, key('z', 'KeyZ', { metaKey: true }))).toBe(true);
    expect(chordMatches(z, key('Z', 'KeyZ', { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(chordMatches(parseChord('R'), key('R', 'KeyR', { shiftKey: true }))).toBe(false);
    expect(chordMatches(parseChord('Shift+R'), key('R', 'KeyR', { shiftKey: true }))).toBe(true);
  });

  it('follows the layout’s letter, falling back to the physical key only when no letter was typed', () => {
    // AZERTY: the key labelled A sits where QWERTY has Q.
    expect(chordMatches(parseChord('Ctrl+A'), key('a', 'KeyQ', { ctrlKey: true }))).toBe(true);
    expect(chordMatches(parseChord('Ctrl+Q'), key('a', 'KeyQ', { ctrlKey: true }))).toBe(false);
    // macOS Option+S types "ß".
    expect(chordMatches(parseChord('Alt+S'), key('ß', 'KeyS', { altKey: true }))).toBe(true);
  });

  it('symbols ignore Shift; named keys don’t', () => {
    expect(chordMatches(parseChord('?'), key('?', 'Slash', { shiftKey: true }))).toBe(true);
    expect(chordMatches(parseChord('Space'), key(' ', 'Space'))).toBe(true);
    expect(chordMatches(parseChord('Space'), key(' ', 'Space', { shiftKey: true }))).toBe(false);
    expect(chordMatches(parseChord('Delete'), key('Delete', 'Delete', { ctrlKey: true }))).toBe(false);
  });

  it('formats for display', () => {
    expect(formatChord(parseChord('Ctrl+Shift+Z'))).toBe('Ctrl+Shift+Z');
    expect(formatChord(parseChord('Space'))).toBe('Space');
    expect(formatChord(parseChord('PageDown'))).toBe('Page Down');
    expect(formatChord(parseChord('Alt+S'))).toBe('Alt+S');
  });
});

describe('command catalog', () => {
  it('has unique ids and no two commands on the same chord', () => {
    const ids = COMMAND_SPECS.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const chords = COMMAND_SPECS.flatMap(c => (c.keys ?? []).map(k => formatChord(parseChord(k))));
    expect(new Set(chords).size).toBe(chords.length);
  });

  it('routes keys to commands, keeping similar chords apart', () => {
    expect(commandForKey(key('x', 'KeyX'))).toBe('tool.delete');
    expect(commandForKey(key('x', 'KeyX', { ctrlKey: true }))).toBe('edit.cut');
    expect(commandForKey(key('s', 'KeyS'))).toBe('snap.toggle');
    expect(commandForKey(key('S', 'KeyS', { shiftKey: true }))).toBe('edit.smooth');
    expect(commandForKey(key('s', 'KeyS', { altKey: true }))).toBe('edit.sharpen');
    expect(commandForKey(key('y', 'KeyY', { ctrlKey: true }))).toBe('edit.redo');
    expect(commandForKey(key('Z', 'KeyZ', { ctrlKey: true, shiftKey: true }))).toBe('edit.redo');
    expect(commandForKey(key('q', 'KeyQ'))).toBeNull();
  });

  it('builds tooltips and shortcut text from the catalog', () => {
    expect(commandTitle('tool.draw')).toBe('Draw (D)');
    expect(commandTitle('transport.jam')).toBe('Jam (J) — free-running clock: sound on, nothing recorded');
    expect(commandTitle('file.save')).toBe('Save Composition');
    expect(shortcutText('edit.redo')).toBe('Ctrl+Shift+Z / Ctrl+Y');
  });
});
