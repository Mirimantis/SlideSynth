/**
 * The canvas's side of the theme (BACKLOG 16.7). styles/theme.css holds every
 * colour as a CSS custom property; the renderers read the same tokens here,
 * resolved to plain rgb()/rgba() strings a canvas accepts, so the canvas and
 * the chrome can't drift apart.
 *
 * loadTheme() resolves them once the stylesheets are in; call it again after
 * switching themes, then redraw.
 */

/** Every token the canvas draws with, by its CSS name without the `--`. */
export const CANVAS_TOKENS = [
  'accent', 'tone-fallback',
  // Staff
  'staff-line-c', 'staff-line-natural', 'staff-line-accidental', 'staff-label-c', 'staff-label',
  'staff-key-c', 'staff-key-natural', 'staff-key-accidental', 'staff-key-out',
  'staff-key-label-c', 'staff-key-label', 'staff-key-label-out',
  'staff-micro-line', 'staff-micro-label',
  'staff-measure', 'staff-beat', 'staff-subdiv-eighth', 'staff-subdiv-quarter', 'staff-subdiv-fine',
  'staff-measure-label', 'staff-beat-label',
  // Rulers
  'ruler-border', 'ruler-divider', 'ruler-seconds-bg', 'ruler-seconds-minor', 'ruler-seconds-major',
  'ruler-seconds-label', 'ruler-beats-bg', 'ruler-tick-measure', 'ruler-tick-beat', 'ruler-tick-eighth',
  'ruler-tick-quarter', 'ruler-tick-fine', 'ruler-measure-label', 'ruler-beat-label',
  // Curves and editing
  'point-outline', 'point-highlight',
  'transform-fill', 'transform-outline', 'transform-handle', 'transform-handle-active', 'transform-handle-edge',
  'transform-arrow', 'ungroup-bg', 'ungroup-edge', 'ungroup-text', 'group-outline', 'group-label',
  'marquee-fill', 'marquee-stroke', 'scissors-dot', 'scissors-dot-edge',
  // Guides and loop
  'guide', 'guide-selected', 'guide-label-bg', 'loop-in', 'loop-out', 'loop-range',
  // Playhead, planchette, metronome
  'playhead', 'planchette', 'planchette-ghost', 'planchette-pulse', 'loop-flash',
  'metronome-downbeat', 'metronome-accent', 'metronome-beat',
  // Harmonic Prism
  'echo-stroke', 'prism-primary-edge', 'prism-harmony-edge',
  'spectrum-1', 'spectrum-2', 'spectrum-3', 'spectrum-4', 'spectrum-5', 'spectrum-6', 'spectrum-7',
  // Parameters Graph
  'param-grid', 'param-grid-mid', 'param-grid-faint', 'param-playhead', 'param-range',
] as const;

export type CanvasToken = typeof CANVAS_TOKENS[number];

/** What a token draws as until the theme loads, or when it's missing:
 *  loud, so a gap shows. (Tests run without a document and never draw.) */
const MISSING = '#ff00ff';

const resolved = new Map<CanvasToken, string>();

/** A theme colour, ready for fillStyle / strokeStyle. */
export function themeColor(token: CanvasToken): string {
  return resolved.get(token) ?? MISSING;
}

/** The Prism spectrum in voice order (primary, then each harmony). */
const SPECTRUM: readonly CanvasToken[] = [
  'spectrum-1', 'spectrum-2', 'spectrum-3', 'spectrum-4', 'spectrum-5', 'spectrum-6', 'spectrum-7',
];
export function prismSpectrum(): readonly string[] {
  return SPECTRUM.map(themeColor);
}

/** Resolve every canvas token from the page's stylesheets. A probe element
 *  turns `var(--x)`, including `rgba(var(--x-rgb), a)`, into a computed
 *  colour. */
export function loadTheme(root: HTMLElement = document.documentElement): void {
  const defined = getComputedStyle(root);
  const probe = document.createElement('span');
  probe.style.display = 'none';
  root.appendChild(probe);
  for (const token of CANVAS_TOKENS) {
    if (!defined.getPropertyValue(`--${token}`).trim()) {
      console.warn(`theme: --${token} is not defined`);
      resolved.set(token, MISSING);
      continue;
    }
    probe.style.color = `var(--${token})`;
    resolved.set(token, getComputedStyle(probe).color);
  }
  probe.remove();
}
