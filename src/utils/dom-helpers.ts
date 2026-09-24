/** Create an element with attributes and children. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string>,
  ...children: (HTMLElement | string)[]
): HTMLElementTagNameMap[K] {
  const elem = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      elem.setAttribute(k, v);
    }
  }
  for (const child of children) {
    if (typeof child === 'string') {
      elem.appendChild(document.createTextNode(child));
    } else {
      elem.appendChild(child);
    }
  }
  return elem;
}

/** Escape text for interpolation into HTML (content or attribute values).
 *  Track and guide names come from loaded files, so they're never trusted. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]!));
}

const lastHtml = new WeakMap<Element, string>();

/**
 * Replace `container`'s content with `html` only if it differs from what this
 * helper last wrote there (BACKLOG 15.1). Returns true when the DOM was
 * replaced, so the caller knows to (re)attach element-level listeners.
 *
 * Panels re-run on every relevant store change — including every mousemove of
 * a drag — so this keeps the DOM, focus and any in-progress slider drag intact
 * whenever what the panel shows hasn't actually changed. Listeners on
 * persisted content must look state up at event time (by id), never capture
 * objects from the render, because the render can be skipped after undo swaps
 * those objects out.
 */
export function setHtmlIfChanged(container: Element, html: string): boolean {
  if (lastHtml.get(container) === html) return false;
  container.innerHTML = html;
  lastHtml.set(container, html);
  return true;
}
