/**
 * Type surface for svg-normalize.js (plain ESM JS so Node can import it too).
 */

/**
 * Normalize raw SVG markup into a shape-only icon that uses `currentColor`,
 * stripping editor cruft and any opaque background rect. Idempotent.
 */
export function normalizeSvg(raw: string): string;
