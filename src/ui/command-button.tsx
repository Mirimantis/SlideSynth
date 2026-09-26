import type { ComponentChildren } from 'preact';
import { commandSpec, commandTitle, type CommandId } from '../commands/catalog';
import type { CommandRegistry } from '../commands/registry';

/** A button that runs a command and hands focus back to the page, so the next
 *  Space or letter key reaches the keyboard map, not the button. */
export function CommandButton({ id, commands, class: cls, title, disabled, pressed, children }: {
  id: CommandId;
  commands: CommandRegistry;
  class?: string;
  title?: string;
  disabled?: boolean;
  pressed?: boolean;
  children: ComponentChildren;
}) {
  return (
    <button
      class={cls}
      title={title ?? commandTitle(id)}
      aria-label={commandSpec(id).label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={e => {
        (e.currentTarget as HTMLElement).blur();
        commands.run(id);
      }}
    >
      {children}
    </button>
  );
}
