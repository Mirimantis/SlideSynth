/**
 * Form controls let go of focus once they commit a value (split out of
 * main.ts in 15.3), so the canvas hotkeys work without an extra click-off.
 */

/** Text-like inputs keep focus: the user is typing. */
const TEXT_TYPES = new Set(['text', 'number', 'search', 'email', 'password', 'url', 'tel']);

export function installBlurOnCommit(): void {
  // `change` is the right event here: range inputs fire it on mouseup (after
  // their continuous `input` stream), selects fire it after the native popup
  // closes, and checkboxes/radios fire on toggle. Text-like inputs and
  // textareas are intentionally skipped — they should keep focus while the
  // user is typing.
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (t instanceof HTMLInputElement && TEXT_TYPES.has(t.type)) return;
    if (t instanceof HTMLTextAreaElement) return;
    if (t.isContentEditable) return;
    t.blur();
  });
}
