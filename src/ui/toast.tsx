import '@preact/signals'; // the toast re-renders when its signal changes
import { signal } from '@preact/signals';
import { useLayoutEffect, useRef } from 'preact/hooks';

/**
 * Lightweight transient toast — fades in at the bottom centre, fades out
 * after a short delay. Used for refused actions where the user benefits from
 * a brief explanation (e.g. "can't join curves from different groups"). A
 * Preact component since BACKLOG 15.4; layout.tsx renders it.
 */

interface ToastState {
  message: string;
  /** A new toast replaces the old one outright: a new element, fading in. */
  key: number;
  shown: boolean;
}

const toast = signal<ToastState | null>(null);
let nextKey = 0;
let hideTimer: number | null = null;
let removeTimer: number | null = null;

/** The fade-out, in ms (styles/main.css › .slidesynth-toast). */
const FADE_MS = 200;

export function showToast(message: string, durationMs = 2200): void {
  if (hideTimer !== null) window.clearTimeout(hideTimer);
  if (removeTimer !== null) window.clearTimeout(removeTimer);
  removeTimer = null;
  const key = ++nextKey;
  toast.value = { message, key, shown: false };
  hideTimer = window.setTimeout(() => {
    hideTimer = null;
    if (toast.peek()?.key !== key) return;
    toast.value = { message, key, shown: false };
    removeTimer = window.setTimeout(() => {
      removeTimer = null;
      if (toast.peek()?.key === key) toast.value = null;
    }, FADE_MS);
  }, durationMs);
}

export function Toast() {
  const t = toast.value;
  return t ? <ToastMessage key={t.key} state={t} /> : null;
}

function ToastMessage({ state }: { state: ToastState }) {
  const el = useRef<HTMLDivElement>(null);
  // Laid out hidden first, so the opacity transition runs as it shows.
  useLayoutEffect(() => {
    if (state.shown || state.key !== nextKey || hideTimer === null) return;
    void el.current?.offsetHeight;
    toast.value = { ...state, shown: true };
  }, [state]);
  return <div ref={el} class={`slidesynth-toast${state.shown ? ' visible' : ''}`}>{state.message}</div>;
}
