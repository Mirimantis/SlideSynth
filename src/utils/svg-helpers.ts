/**
 * SVG icon helpers.
 *
 * Icons are authored as SHAPE-ONLY SVG files under src/assets/icons/ — geometry,
 * stroke-width and fill/stroke regions, but NO baked-in colors. Shapes use
 * `fill="currentColor"` / `stroke="currentColor"` so color is driven entirely
 * from CSS (the host element's `color`, typically a `--icon-color-*` variable).
 * This keeps the SVGs hand-editable for skinning while letting code/themes
 * recolor them dynamically.
 *
 * Import an icon with Vite's built-in `?raw` suffix to get its markup as a string:
 *   import drawIcon from '../assets/icons/tools.svg?raw';
 *   setIcon(button, drawIcon);
 */

/**
 * Replace `host`'s contents with the given raw SVG markup and return the
 * injected <svg> element (or null if the markup contained none). Local trusted
 * assets only — do not pass user-supplied markup.
 */
export function setIcon(host: HTMLElement, rawSvg: string): SVGElement | null {
  host.innerHTML = rawSvg;
  const svg = host.querySelector('svg');
  if (svg) svg.classList.add('icon-svg');
  return svg;
}

/**
 * Build a <span class="icon ..."> wrapping the given raw SVG, for inline use in
 * template-string DOM or as a standalone element.
 */
export function iconSpan(rawSvg: string, extraClass?: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = extraClass ? `icon ${extraClass}` : 'icon';
  setIcon(span, rawSvg);
  return span;
}
