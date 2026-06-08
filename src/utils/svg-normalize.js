/**
 * Editor-agnostic SVG icon normalizer.
 *
 * Turns a raw SVG exported from ANY tool (Graphite, Inkscape, Illustrator, …)
 * into a shape-only icon that obeys the project's coloring contract: geometry
 * is preserved, but every baked-in color is rewritten to `currentColor` so the
 * UI can drive it from CSS. See src/utils/svg-helpers.ts for that contract.
 *
 * It is the single source of truth for cleanup, shared by:
 *   - scripts/normalize-icons.mjs  (batch-rewrites committed files: `npm run icons`)
 *   - src/utils/svg-helpers.ts     (runtime safety net at injection time)
 *
 * Plain ESM JS (no TS syntax) so Node can import it directly; types live in the
 * sibling svg-normalize.d.ts. The transform is idempotent — running it on
 * already-normalized markup is a no-op.
 *
 * What it does:
 *   - strips XML prolog, DOCTYPE, comments, <metadata>, <title>, <desc>,
 *     <sodipodi:namedview>, <clipPath> and emptied <defs>
 *   - removes editor namespaces (inkscape:, sodipodi:, dc:, cc:, rdf:, graphite:)
 *     and editor-only attributes (sodipodi:*, inkscape:*, clip-path)
 *   - removes a full-bleed background <rect> (the opaque artboard fill)
 *   - rewrites fill/stroke colors — both presentation attrs and style="…" —
 *     to currentColor (leaving `none`, `currentColor`, and url(#…) refs alone)
 *   - drops width/height/version/x/y from the root <svg> so CSS controls size
 *   - re-indents the result for readable diffs
 */

function parseAttrs(tag) {
  const attrs = {};
  const re = /([\w:-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(tag))) attrs[m[1]] = m[2];
  return attrs;
}

function pxNum(v) {
  if (v == null) return NaN;
  return parseFloat(String(v).replace(/px$/i, ''));
}

const approx = (a, b) => Math.abs(a - b) < 0.5;

function rewriteColor(prop, val) {
  const v = val.trim().toLowerCase();
  if (v === '' || v === 'none' || v === 'currentcolor' || v.startsWith('url(')) {
    return `${prop}="${val.trim()}"`;
  }
  return `${prop}="currentColor"`;
}

/** Re-indent tag soup by nesting depth for clean, reviewable diffs. */
function reindent(s) {
  const tokens = s.replace(/>\s+</g, '><').match(/<[^>]+>|[^<]+/g) || [];
  let depth = 0;
  const out = [];
  for (let raw of tokens) {
    const t = raw.trim();
    if (!t) continue;
    const isClose = /^<\//.test(t);
    const isDecl = /^<[?!]/.test(t);
    const isSelf = /\/>$/.test(t);
    const isOpen = /^<[^/?!]/.test(t) && !isSelf;
    if (isClose) depth = Math.max(0, depth - 1);
    out.push('  '.repeat(depth) + t);
    if (isOpen && !isDecl) depth++;
  }
  return out.join('\n');
}

/**
 * Normalize raw SVG markup. Returns shape-only markup using currentColor.
 * Idempotent and safe to run on already-clean files.
 */
export function normalizeSvg(raw) {
  let s = String(raw);

  // 1. Strip prolog / doctype / comments / editor-only elements.
  s = s
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<metadata\b[\s\S]*?<\/metadata>/gi, '')
    .replace(/<sodipodi:namedview\b[\s\S]*?(?:\/>|<\/sodipodi:namedview>)/gi, '')
    .replace(/<title\b[\s\S]*?<\/title>/gi, '')
    .replace(/<desc\b[\s\S]*?<\/desc>/gi, '')
    .replace(/<clipPath\b[\s\S]*?<\/clipPath>/gi, '')
    .replace(/<defs\b[^>]*>\s*<\/defs>/gi, '');

  // 2. Remove a full-bleed background rect (opaque artboard fill).
  const vb = (s.match(/viewBox\s*=\s*"([^"]*)"/i) || [])[1];
  let vbW = null;
  let vbH = null;
  if (vb) {
    const p = vb.trim().split(/[\s,]+/).map(Number);
    vbW = p[2];
    vbH = p[3];
  }
  s = s.replace(/<rect\b[^>]*?(?:\/>|>\s*<\/rect>)/gi, (m) => {
    const a = parseAttrs(m);
    const fill = (a.fill || '').trim().toLowerCase();
    const styleFill = (((a.style || '').match(/fill\s*:\s*([^;]*)/i) || [])[1] || '')
      .trim()
      .toLowerCase();
    if (fill === 'none' || styleFill === 'none') return m;
    if (a.width === '100%' && a.height === '100%') return '';
    if (
      vbW != null &&
      approx(pxNum(a.width), vbW) &&
      approx(pxNum(a.height), vbH) &&
      approx(pxNum(a.x) || 0, 0) &&
      approx(pxNum(a.y) || 0, 0)
    ) {
      return '';
    }
    return m;
  });

  // 3. Rewrite baked-in colors -> currentColor (attributes and style props).
  s = s.replace(/\b(fill|stroke)\s*=\s*"([^"]*)"/gi, (_m, prop, val) =>
    rewriteColor(prop, val),
  );
  s = s.replace(/style\s*=\s*"([^"]*)"/gi, (_m, body) => {
    const nb = body
      .replace(/(fill|stroke)\s*:\s*([^;]*)/gi, (mm, prop, val) => {
        const v = val.trim().toLowerCase();
        if (v === '' || v === 'none' || v === 'currentcolor' || v.startsWith('url(')) {
          return `${prop}:${val.trim()}`;
        }
        return `${prop}:currentColor`;
      })
      .replace(/;\s*;/g, ';')
      .replace(/^\s*;|;\s*$/g, '')
      .trim();
    return nb ? `style="${nb}"` : '';
  });

  // 4. Strip editor namespaces, editor attributes, and clip-path references.
  s = s
    .replace(/\s+xmlns:(inkscape|sodipodi|dc|cc|rdf|graphite|svg)\s*=\s*"[^"]*"/gi, '')
    .replace(/\s+(inkscape|sodipodi):[\w:-]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\s+clip-path\s*=\s*"[^"]*"/gi, '');

  // 5. Clean the root <svg> tag: drop sizing/version cruft, ensure xmlns.
  s = s.replace(/<svg\b([^>]*)>/i, (_m, attrs) => {
    let a = attrs.replace(
      /\s+(width|height|version|x|y|xml:space|enable-background|data-name|style)\s*=\s*"[^"]*"/gi,
      '',
    );
    if (!/\bxmlns\s*=/.test(a)) a = ' xmlns="http://www.w3.org/2000/svg"' + a;
    a = a.replace(/\s+/g, ' ').trim();
    return `<svg ${a}>`;
  });

  return reindent(s).trim() + '\n';
}
