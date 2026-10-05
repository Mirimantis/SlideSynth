import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { showDialog } from './dialog-host';

/**
 * The canvas's right-click menu (BACKLOG 15.4: a Preact component since
 * then). A press outside it, Escape, resizing or leaving the window closes it.
 */

export interface ContextMenuItem {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick(): void;
}

/** Closes the menu that's open, if one is. */
let closeOpen: (() => void) | null = null;

/** Close the currently-open context menu, if any. */
export function closeContextMenu(): void {
  closeOpen?.();
}

/**
 * Open a context menu at the given page coordinates with the given items.
 * Disabled items don't respond to clicks. Any existing menu is closed first.
 */
export function openContextMenu(pageX: number, pageY: number, items: readonly ContextMenuItem[]): void {
  closeContextMenu();
  if (items.length === 0) return;
  void showDialog<void>(done => {
    closeOpen = () => { closeOpen = null; done(); };
    return <ContextMenu x={pageX} y={pageY} items={items} onClose={closeContextMenu} />;
  });
}

export function ContextMenu({ x, y, items, onClose }: {
  x: number;
  y: number;
  items: readonly ContextMenuItem[];
  onClose(): void;
}) {
  const menu = useRef<HTMLDivElement>(null);

  // Position, clamping within viewport so it never spills off the right/bottom edge.
  useLayoutEffect(() => {
    const el = menu.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.left = `${Math.max(0, Math.min(x, window.innerWidth - rect.width - 4))}px`;
    el.style.top = `${Math.max(0, Math.min(y, window.innerHeight - rect.height - 4))}px`;
  }, []);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    // mousedown before the global handler can steal focus / start a drag.
    document.addEventListener('mousedown', onDocMouseDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, []);

  return (
    <div class="context-menu" ref={menu}>
      {items.map(item => (
        <div
          key={item.label}
          class={`context-menu-item${item.disabled ? ' disabled' : ''}`}
          onMouseDown={item.disabled ? undefined : e => {
            e.preventDefault();
            e.stopPropagation();
            onClose();
            item.onClick();
          }}
        >
          <span class="context-menu-label">{item.label}</span>
          {item.shortcut && <span class="context-menu-shortcut">{item.shortcut}</span>}
        </div>
      ))}
    </div>
  );
}
