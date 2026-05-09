import type { Track, ToneDefinition } from '../types';

/**
 * Asks the user which track to MIDI-arm. Shown when a MIDI device is selected
 * with no track currently armed, so the user can't miss the arming step (the
 * symptom otherwise is "I hear notes but no curves appear").
 *
 * Resolves to:
 *  - { kind: 'arm-existing', trackId } — caller should arm that track.
 *  - { kind: 'arm-new' } — caller should run the add-track flow then arm.
 *  - null — Cancel / Escape; nothing armed.
 */
export type MidiArmDialogResult =
  | { kind: 'arm-existing'; trackId: string }
  | { kind: 'arm-new' }
  | null;

export function openMidiArmDialog(opts: {
  tracks: readonly Track[];
  toneLibrary: readonly ToneDefinition[];
}): Promise<MidiArmDialogResult> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'modal midi-arm-modal';
    modal.style.maxWidth = '380px';

    const hasTracks = opts.tracks.length > 0;

    const trackRows = opts.tracks.map((t, i) => {
      const tone = opts.toneLibrary.find(x => x.id === t.toneId);
      const color = tone?.color ?? '#888';
      const toneName = tone?.name ?? '?';
      return `
        <label class="midi-arm-row">
          <input type="radio" name="midi-arm-track" value="${escapeAttr(t.id)}" ${i === 0 ? 'checked' : ''} />
          <span class="midi-arm-swatch" style="background:${escapeAttr(color)}"></span>
          <span class="midi-arm-name">${escapeHtml(t.name)}</span>
          <span class="midi-arm-tone" style="color:${escapeAttr(color)}">${escapeHtml(toneName)}</span>
        </label>
      `;
    }).join('');

    modal.innerHTML = `
      <h2>Record MIDI into which track?</h2>
      ${hasTracks ? `<div class="midi-arm-list">${trackRows}</div>` : `
        <p class="midi-arm-empty">No tracks yet. Create one to record into:</p>
      `}
      <div class="midi-arm-newrow">
        <button id="midi-arm-new" class="tb-btn">+ New track</button>
      </div>
      <div class="tb-actions" style="justify-content: flex-end;">
        <button id="midi-arm-cancel" class="tb-btn">Cancel</button>
        ${hasTracks ? `<button id="midi-arm-confirm" class="tb-btn primary">Arm</button>` : ''}
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const cancelBtn = modal.querySelector('#midi-arm-cancel') as HTMLButtonElement;
    const newBtn = modal.querySelector('#midi-arm-new') as HTMLButtonElement;
    const confirmBtn = modal.querySelector('#midi-arm-confirm') as HTMLButtonElement | null;

    function cleanup() {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }

    function pickExisting() {
      const radio = modal.querySelector<HTMLInputElement>('input[name="midi-arm-track"]:checked');
      if (!radio) return;
      cleanup();
      resolve({ kind: 'arm-existing', trackId: radio.value });
    }

    cancelBtn.addEventListener('click', () => {
      cleanup();
      resolve(null);
    });

    newBtn.addEventListener('click', () => {
      cleanup();
      resolve({ kind: 'arm-new' });
    });

    if (confirmBtn) {
      confirmBtn.addEventListener('click', pickExisting);
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        cleanup();
        resolve(null);
      } else if (e.key === 'Enter' && hasTracks) {
        e.preventDefault();
        pickExisting();
      }
    }
    document.addEventListener('keydown', onKey);

    setTimeout(() => {
      (confirmBtn ?? newBtn).focus();
    }, 0);
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]!));
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}
