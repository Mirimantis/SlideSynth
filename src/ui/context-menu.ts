export interface ContextMenuItem {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick(): void;
}

let activeCleanup: (() => void) | null = null;

/** Close the currently-open context menu, if any. */
export function closeContextMenu(): void {
  if (activeCleanup) {
    activeCleanup();
    activeCleanup = null;
  }
}

/**
 * Open a context menu at the given page coordinates with the given items.
 * Disabled items don't respond to clicks. Any existing menu is closed first.
 */
export function openContextMenu(pageX: number, pageY: number, items: ContextMenuItem[]): void {
  closeContextMenu();
  if (items.length === 0) return;

  const menu = document.createElement('div');
  menu.className = 'context-menu';

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'context-menu-item';
    if (item.disabled) row.classList.add('disabled');
    row.innerHTML = `
      <span class="context-menu-label">${item.label}</span>
      ${item.shortcut ? `<span class="context-menu-shortcut">${item.shortcut}</span>` : ''}
    `;
    if (!item.disabled) {
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeContextMenu();
        item.onClick();
      });
    }
    menu.appendChild(row);
  }

  document.body.appendChild(menu);

  // Position, clamping within viewport so it never spills off the right/bottom edge.
  const rect = menu.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const x = Math.min(pageX, vw - rect.width - 4);
  const y = Math.min(pageY, vh - rect.height - 4);
  menu.style.left = `${Math.max(0, x)}px`;
  menu.style.top = `${Math.max(0, y)}px`;

  const onDocMouseDown = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) closeContextMenu();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeContextMenu();
    }
  };
  const onScroll = () => closeContextMenu();
  // mousedown before the global handler can steal focus / start a drag.
  document.addEventListener('mousedown', onDocMouseDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', onScroll);
  window.addEventListener('blur', onScroll);

  activeCleanup = () => {
    document.removeEventListener('mousedown', onDocMouseDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('resize', onScroll);
    window.removeEventListener('blur', onScroll);
    if (menu.parentNode) menu.parentNode.removeChild(menu);
  };
}
