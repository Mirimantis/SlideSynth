/**
 * Icon-rail drawer controller.
 *
 * The left rail holds one icon button per section (data-drawer="<id>"). Clicking
 * an icon toggles an overlay drawer that slides out over the canvas edge; only
 * one drawer is open at a time. Drawers are absolutely positioned (CSS) so the
 * canvas never reflows when they open or close.
 */

export interface DrawerRail {
  open(id: string): void;
  close(): void;
  toggle(id: string): void;
  current(): string | null;
}

/**
 * Wire a rail element (containing `.rail-icon[data-drawer]` buttons) to a host
 * element (containing `.drawer[data-drawer]` panels).
 */
export function createDrawerRail(railEl: HTMLElement, hostEl: HTMLElement): DrawerRail {
  const icons = Array.from(railEl.querySelectorAll<HTMLElement>('.rail-icon'));
  const drawers = Array.from(hostEl.querySelectorAll<HTMLElement>('.drawer'));
  let openId: string | null = null;

  function render() {
    for (const icon of icons) {
      icon.classList.toggle('active', icon.dataset.drawer === openId);
    }
    for (const drawer of drawers) {
      drawer.classList.toggle('open', drawer.dataset.drawer === openId);
    }
    hostEl.classList.toggle('has-open', openId !== null);
  }

  const api: DrawerRail = {
    open(id) { openId = id; render(); },
    close() { openId = null; render(); },
    toggle(id) { openId = openId === id ? null : id; render(); },
    current() { return openId; },
  };

  for (const icon of icons) {
    icon.addEventListener('click', () => {
      const id = icon.dataset.drawer;
      if (id) api.toggle(id);
    });
  }

  // Escape closes the open drawer.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openId !== null) {
      // Don't steal Escape from text inputs (name field, etc.).
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      api.close();
    }
  });

  // Click outside the rail/drawer (e.g. on the canvas) closes the open drawer.
  // mousedown fires before the rail icon's click, but clicks ON the rail/host
  // are excluded here so toggling still works.
  document.addEventListener('mousedown', (e) => {
    if (openId === null) return;
    const t = e.target as Node | null;
    if (t && (railEl.contains(t) || hostEl.contains(t))) return;
    api.close();
  });

  render();
  return api;
}
