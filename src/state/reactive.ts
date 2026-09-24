import { effect, untracked } from '@preact/signals-core';

export { batch, computed, effect, signal, untracked } from '@preact/signals-core';
export type { ReadonlySignal, Signal } from '@preact/signals-core';

/**
 * Run `run(value)` now and again whenever `select()` produces a different
 * value (BACKLOG 15.1). `select` is tracked — it subscribes to exactly the
 * store fields it reads — while `run` is not, so DOM updates and side effects
 * inside it never add dependencies or re-trigger the watcher.
 *
 * This replaces the old "cache the last value in a module variable and compare
 * inside store.subscribe" pattern. For views that render several fields, have
 * `select` return a string key of everything the view shows; the view then
 * re-renders only when what it displays actually changes.
 *
 * Returns a dispose function.
 */
export function watch<T>(
  select: () => T,
  run: (value: T, previous: T | undefined) => void,
  equals: (a: T, b: T) => boolean = Object.is,
): () => void {
  let first = true;
  let previous: T | undefined;
  return effect(() => {
    const value = select();
    if (!first && equals(value, previous as T)) return;
    const prev = first ? undefined : previous;
    first = false;
    previous = value;
    untracked(() => run(value, prev));
  });
}
