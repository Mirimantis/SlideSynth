import { describe, it, expect } from 'vitest';
import { CANVAS_TOKENS } from './theme';

/**
 * The theme's rules (BACKLOG 16.7): every colour is a token in
 * styles/theme.css, and nothing else names one.
 */

const raw = (files: Record<string, unknown>) =>
  Object.entries(files).map(([path, text]) => ({ path: path.replace(/^\//, ''), text: text as string }));

const STYLES = raw(import.meta.glob('/styles/*.css', { query: '?raw', import: 'default', eager: true }));
const HELP = raw(import.meta.glob('/help.html', { query: '?raw', import: 'default', eager: true }));
const SOURCES = raw(import.meta.glob(['/src/**/*.ts', '/src/**/*.tsx', '!/src/**/*.test.ts', '!/src/**/*.test.tsx'],
  { query: '?raw', import: 'default', eager: true }));

const THEME = STYLES.find(f => f.path.endsWith('theme.css'))!;
const OTHER_STYLES = STYLES.filter(f => f !== THEME);

/** Comments mention tokens and colours without using them. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Every custom property the stylesheets define. */
const DEFINED = new Set([...STYLES, ...HELP].flatMap(f => [...code(f.text).matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]!)));

const HEX = /#[0-9a-fA-F]{3,8}\b/;
const RGB = /\b(rgba?|hsla?)\(\s*\d/;

/** Source files allowed to hold colour literals, and why. */
const ALLOWED = new Set([
  'src/constants.ts',          // the preset tones' colours: data, saved in files
  'src/ui/tone-builder.ts',    // a new tone's starting colour: data
  'src/theme/theme.ts',        // the loud colour for a missing token
]);

describe('theme tokens (BACKLOG 16.7)', () => {
  it('finds the files it checks', () => {
    expect(THEME).toBeDefined();
    expect(OTHER_STYLES.length).toBeGreaterThanOrEqual(3);
    expect(SOURCES.length).toBeGreaterThan(50);
  });

  it('defines every token the canvas draws with', () => {
    expect(CANVAS_TOKENS.filter(t => !DEFINED.has(`--${t}`))).toEqual([]);
  });

  it('defines every token the stylesheets and components use', () => {
    const used = new Set([...STYLES, ...HELP, ...SOURCES]
      .flatMap(f => [...code(f.text).matchAll(/var\((--[\w-]+)/g)].map(m => m[1]!)));
    expect([...used].filter(v => !DEFINED.has(v))).toEqual([]);
  });

  it('no stylesheet but theme.css names a colour', () => {
    const offenders = OTHER_STYLES.flatMap(f => code(f.text).split('\n')
      // Declarations only: `#add-track-btn {` is a selector, not a colour.
      .filter(line => line.includes(':') && !line.includes('{') && (HEX.test(line) || RGB.test(line)))
      .map(line => `${f.path}: ${line.trim()}`));
    expect(offenders).toEqual([]);
  });

  it('no renderer or component names a colour', () => {
    const offenders = SOURCES.filter(f => !ALLOWED.has(f.path)).flatMap(f => code(f.text).split('\n')
      .filter(line => /['"`]#[0-9a-fA-F]{3,8}['"`]/.test(line) || RGB.test(line))
      .map(line => `${f.path}: ${line.trim()}`));
    expect(offenders).toEqual([]);
  });
});
