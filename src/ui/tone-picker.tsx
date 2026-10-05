import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import type { ToneDefinition } from '../types';
import { showDialog } from './dialog-host';
import { DashPreview } from './dash-preview';

/**
 * The tone picker (BACKLOG 15.4: a Preact component since then): a popup by
 * a button listing the library's tones. Click one to pick it; click outside
 * or press Escape to cancel.
 */

/** Cancels the picker that's open, if one is. */
let cancelOpen: (() => void) | null = null;

/** Show the picker by `anchorEl`. Resolves with the chosen tone, or null if
 *  cancelled (opening another picker cancels this one). */
export function openTonePicker(
  tones: readonly ToneDefinition[],
  currentToneId: string | null,
  anchorEl: HTMLElement,
): Promise<ToneDefinition | null> {
  cancelOpen?.();
  return showDialog<ToneDefinition | null>(done => {
    const close = (tone: ToneDefinition | null) => {
      cancelOpen = null;
      done(tone);
    };
    cancelOpen = () => close(null);
    return <TonePicker tones={tones} currentToneId={currentToneId} anchor={anchorEl.getBoundingClientRect()} onPick={close} />;
  });
}

export function TonePicker({ tones, currentToneId, anchor, onPick }: {
  tones: readonly ToneDefinition[];
  currentToneId: string | null;
  /** Where the button is: the popup opens below it. */
  anchor: { top: number; bottom: number; left: number };
  onPick(tone: ToneDefinition | null): void;
}) {
  const popup = useRef<HTMLDivElement>(null);

  // Keep the popup on screen: in from the right edge, and above the button
  // if there's no room below.
  useLayoutEffect(() => {
    const el = popup.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.right > window.innerWidth - 8) el.style.left = `${window.innerWidth - r.width - 8}px`;
    if (r.bottom > window.innerHeight - 8) el.style.top = `${anchor.top - r.height - 4}px`;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onPick(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div class="tone-picker-overlay" onClick={() => onPick(null)}>
      <div class="tone-picker-popup" ref={popup} style={{ top: `${anchor.bottom + 4}px`, left: `${anchor.left}px` }}>
        <div class="tone-picker-header">Select Tone</div>
        {tones.map(tone => (
          <div
            key={tone.id}
            class={`tone-picker-item${tone.id === currentToneId ? ' current' : ''}`}
            onClick={e => { e.stopPropagation(); onPick(tone); }}
          >
            <div class="tone-picker-swatch" style={{ background: tone.color }}></div>
            <DashPreview class="tone-picker-dash" color={tone.color} pattern={tone.dashPattern} width={30} height={10} />
            <span class="tone-picker-name">{tone.name}</span>
            <span class="tone-picker-info">{tone.layers.map(l => l.type[0]!.toUpperCase()).join('+')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
