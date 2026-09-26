import '@preact/signals'; // menus re-render when the settings they show change
import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { commandSpec, primaryShortcut, type CommandId } from '../commands/catalog';
import type { CommandRegistry } from '../commands/registry';

/**
 * Menus (BACKLOG 16.3): the File / Edit / View menu bar and the Record
 * button's menu. Every item is a command from the catalog, so a menu shows the
 * same label and shortcut as the tooltip and the help page, greys out when the
 * command can't run, and shows a check mark when it's an on/off setting.
 */

/** A command, or '-' for a divider. */
export type MenuEntry = CommandId | '-';

export interface MenuSpec {
  label: string;
  entries: readonly MenuEntry[];
}

/** While `active`, Escape closes the menu and goes no further — it doesn't
 *  also leave Perform or close a drawer. */
export function useEscapeToClose(active: boolean, close: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      // Immediate: the keyboard map listens on window too, and a key event
      // aimed at window itself reaches every window listener otherwise.
      e.stopImmediatePropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active]);
}

/** An open menu's items. Rendered only while open, so whether each command
 *  can run is read when the menu opens. */
export function MenuItems({ entries, commands, onPick }: {
  entries: readonly MenuEntry[];
  commands: CommandRegistry;
  onPick(id: CommandId): void;
}) {
  return (
    <div class="menu-dropdown" role="menu">
      {entries.map((entry, i) => (entry === '-'
        ? <div key={`-${i}`} class="menu-divider" role="separator" />
        : <MenuItem key={entry} id={entry} commands={commands} onPick={onPick} />))}
    </div>
  );
}

function MenuItem({ id, commands, onPick }: { id: CommandId; commands: CommandRegistry; onPick(id: CommandId): void }) {
  const spec = commandSpec(id);
  const checked = commands.checked(id);
  return (
    <button
      class="menu-item"
      role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={checked}
      disabled={!commands.enabled(id)}
      title={spec.description}
      onClick={() => onPick(id)}
    >
      <span class="menu-check">{checked ? '✓' : ''}</span>
      <span class="menu-label">{spec.label}</span>
      <span class="menu-shortcut">{primaryShortcut(id)}</span>
    </button>
  );
}

/** Click-away catcher behind an open menu. It takes the click, so closing a
 *  menu doesn't also draw on the canvas. */
function MenuOverlay({ onClose }: { onClose(): void }) {
  return <div class="menu-overlay" onClick={onClose} />;
}

/** File / Edit / View. Once one menu is open, pointing at another title opens
 *  that one, as in a desktop menu bar. */
export function MenuBar({ menus, commands }: { menus: readonly MenuSpec[]; commands: CommandRegistry }) {
  const [open, setOpen] = useState<number | null>(null);
  const close = () => setOpen(null);
  useEscapeToClose(open !== null, close);
  return (
    <div class="menu-bar">
      {open !== null && <MenuOverlay onClose={close} />}
      {menus.map((menu, i) => (
        <div key={menu.label} class={`menu-root${open === i ? ' open' : ''}`}>
          <button
            class={`tb-btn menu-title${open === i ? ' active' : ''}`}
            aria-haspopup="menu"
            aria-expanded={open === i}
            onClick={e => {
              (e.currentTarget as HTMLElement).blur();
              setOpen(open === i ? null : i);
            }}
            onPointerEnter={() => { if (open !== null && open !== i) setOpen(i); }}
          >
            {menu.label}
          </button>
          {open === i && (
            <MenuItems entries={menu.entries} commands={commands} onPick={id => { close(); commands.run(id); }} />
          )}
        </div>
      ))}
    </div>
  );
}

/** A button with a menu hanging off it (the Record button's caret). */
export function MenuButton({ entries, commands, title, class: cls, disabled, children }: {
  entries: readonly MenuEntry[];
  commands: CommandRegistry;
  title: string;
  class?: string;
  disabled?: boolean;
  children: ComponentChildren;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  useEscapeToClose(open, close);
  return (
    <div class={`menu-root${open ? ' open' : ''}`}>
      {open && <MenuOverlay onClose={close} />}
      <button
        class={cls}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={e => {
          (e.currentTarget as HTMLElement).blur();
          setOpen(!open);
        }}
      >
        {children}
      </button>
      {open && <MenuItems entries={entries} commands={commands} onPick={id => { close(); commands.run(id); }} />}
    </div>
  );
}
