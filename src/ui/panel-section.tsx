import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

/**
 * Collapsible sections: the side panel's Tool, Selection and Tracks, and the
 * Prism drawer's Voicing. Which are collapsed is remembered between visits.
 */

/** Which sections are collapsed, by title, kept between visits. */
const COLLAPSED_KEY = 'slidesynth.collapsedPanels';

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveCollapsed(title: string, collapsed: boolean): void {
  const set = loadCollapsed();
  if (collapsed) set.add(title); else set.delete(title);
  try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set])); } catch { /* storage unavailable */ }
}

/** A section with a header that collapses and expands it. */
export function PanelSection({ title, id, headerStyle, children }: {
  title: string;
  /** The content's id. */
  id?: string;
  headerStyle?: string;
  children: ComponentChildren;
}) {
  const [collapsed, setCollapsed] = useState(() => loadCollapsed().has(title));
  return (
    <>
      <div
        class={`panel-header${collapsed ? ' collapsed' : ''}`}
        style={headerStyle}
        onClick={() => { setCollapsed(!collapsed); saveCollapsed(title, !collapsed); }}
      >
        {title}
      </div>
      <div id={id} style={collapsed ? { display: 'none' } : undefined}>{children}</div>
    </>
  );
}
