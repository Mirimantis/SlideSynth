import { normalizeSvg } from '../utils/svg-normalize.js';

const markup = new Map<string, string>();

/**
 * An icon from src/assets/icons as a Preact element. Local trusted assets only.
 *
 * Icons are authored as SHAPE-ONLY SVG files: geometry, stroke-width and
 * fill/stroke regions, but NO baked-in colors. Shapes use
 * `fill="currentColor"` / `stroke="currentColor"` so color is driven entirely
 * from CSS (the host element's `color`, typically a `--icon-color-*` variable).
 * This keeps the SVGs hand-editable for skinning while letting code/themes
 * recolor them dynamically. Import one with Vite's `?raw` suffix to get its
 * markup as a string:
 *   import drawIcon from '../assets/icons/draw.svg?raw';
 *   <Icon svg={drawIcon} />
 *
 * Committed icons are pre-cleaned by `npm run icons`; the same normalizer
 * runs here too as a safety net, so an un-normalized export still renders
 * with the correct color. The transform is idempotent.
 */
export function Icon({ svg }: { svg: string }) {
  let html = markup.get(svg);
  if (html === undefined) {
    html = normalizeSvg(svg).replace('<svg', '<svg class="icon-svg"');
    markup.set(svg, html);
  }
  return <span class="icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />;
}
