import { normalizeSvg } from '../utils/svg-normalize.js';

const markup = new Map<string, string>();

/**
 * An icon from src/assets/icons (imported with `?raw`) as a Preact element —
 * the component twin of `setIcon`. Colour comes from CSS `currentColor`.
 * Local trusted assets only.
 */
export function Icon({ svg }: { svg: string }) {
  let html = markup.get(svg);
  if (html === undefined) {
    html = normalizeSvg(svg).replace('<svg', '<svg class="icon-svg"');
    markup.set(svg, html);
  }
  return <span class="icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />;
}
