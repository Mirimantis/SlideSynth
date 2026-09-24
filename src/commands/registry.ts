import { COMMAND_SPECS, commandSpec, type CommandId } from './catalog';
import { chordMatches, parseChord, type KeyLike } from './keys';

/** What a command does, bound at startup by main.ts (BACKLOG 15.3). */
export interface CommandHandler {
  run(): void;
  /** Hold commands only: the key was released. */
  release?(): void;
  /** When this returns false the command does nothing and menus show it
   *  disabled. Its key goes to the browser, except Ctrl chords, which stay
   *  blocked (Ctrl+J would open Downloads). Default: always enabled. */
  enabled?(): boolean;
}

export interface CommandRegistry {
  /** Run a command if it's enabled. Returns whether it ran. */
  run(id: CommandId): boolean;
  enabled(id: CommandId): boolean;
  /** Listen for the catalog's key chords on `target`. `isTyping` says when a
   *  key belongs to a form field instead. Returns a dispose function. */
  installKeyboard(target: Window, isTyping: (e: KeyboardEvent) => boolean): () => void;
}

const BINDINGS = COMMAND_SPECS.flatMap(c => (c.keys ?? []).map(k => ({ id: c.id, chord: parseChord(k) })));

function bindingFor(e: KeyLike) {
  return BINDINGS.find(b => chordMatches(b.chord, e));
}

/** The command a key event triggers, if any. */
export function commandForKey(e: KeyLike): CommandId | null {
  return bindingFor(e)?.id ?? null;
}

/** Every catalog command needs a handler, so a command can't be listed and
 *  then silently do nothing. */
export function createCommandRegistry(handlers: Record<CommandId, CommandHandler>): CommandRegistry {
  const enabled = (id: CommandId) => handlers[id].enabled?.() ?? true;

  return {
    enabled,
    run(id) {
      if (!enabled(id)) return false;
      handlers[id].run();
      return true;
    },
    installKeyboard(target, isTyping) {
      /** Held keys (by physical key) → the hold command they started, so the
       *  release reaches it even if the modifiers changed meanwhile. */
      const held = new Map<string, CommandId>();

      const onKeyDown = (e: KeyboardEvent) => {
        if (isTyping(e)) return;
        const binding = bindingFor(e);
        if (!binding) return;
        const { id } = binding;
        const spec = commandSpec(id);
        if (!enabled(id)) {
          if (binding.chord.ctrl) e.preventDefault();
          return;
        }
        e.preventDefault();
        if (e.repeat && (spec.once || spec.hold)) return;
        handlers[id].run();
        if (spec.hold) held.set(e.code, id);
      };
      const onKeyUp = (e: KeyboardEvent) => {
        const id = held.get(e.code);
        if (!id) return;
        held.delete(e.code);
        handlers[id].release?.();
      };
      // A keyup while the window is unfocused never arrives; forget holds so
      // the next press starts clean.
      const onBlur = () => held.clear();

      target.addEventListener('keydown', onKeyDown);
      target.addEventListener('keyup', onKeyUp);
      target.addEventListener('blur', onBlur);
      return () => {
        target.removeEventListener('keydown', onKeyDown);
        target.removeEventListener('keyup', onKeyUp);
        target.removeEventListener('blur', onBlur);
      };
    },
  };
}
