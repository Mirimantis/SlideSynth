import { store } from '../state/store';
import { history } from '../state/history';
import { centsToNoteName, CENTS_PER_SEMITONE } from '../constants';
import { getMovableSelection } from '../model/curve-groups';
import { pitchPoints } from '../model/curve';
import { openTonePicker } from './tone-picker';
import { escapeHtml, setHtmlIfChanged } from '../utils/dom-helpers';
import type { Track } from '../types';

const NEW_TRACK_VALUE = '__new__';

function liveTrack(trackId: string): Track | undefined {
  return store.getComposition().tracks.find(t => t.id === trackId);
}

/**
 * Render the property panel contents based on current selection.
 *
 * Runs from an effect on every relevant store change (BACKLOG 15.1). The DOM is
 * replaced only when what the panel shows changes, and listeners look state up
 * by id when they fire — never capture objects from this render, which can be
 * skipped after an undo swaps those objects out. Live-edited values (the track
 * volume slider) are kept out of the HTML and synced separately, so dragging a
 * slider never rebuilds the panel under the pointer.
 */
export function renderPropertyPanel(container: HTMLElement): void {
  const state = store.getState();
  const comp = state.composition;

  // Selected guide takes precedence over track/curve/point — guide selection is
  // mutually exclusive with curve/point selection per setSelectedGuide / setSelectedCurve.
  if (state.selectedGuideId) {
    const guide = comp.guides.find(g => g.id === state.selectedGuideId);
    if (guide) {
      const guideId = guide.id;
      const positionLabel = guide.orientation === 'x'
        ? `${guide.position.toFixed(3)} beats`
        : `${centsToNoteName(guide.position)} (${guide.position.toFixed(1)} ¢)`;
      // Locked guides become read-only in the property panel — the input is
      // disabled and the Delete button hidden. Lock toggle in the Snap section
      // is the way out.
      const locked = state.guidesLocked;
      const html = `
        <div class="prop-section">
          <div class="prop-label">Snap Guide${locked ? ' (locked)' : ''}</div>
          <div class="prop-value">${guide.orientation === 'x' ? 'Vertical (beat)' : 'Horizontal (pitch)'}</div>
        </div>
        <div class="prop-section">
          <div class="prop-label">Position</div>
          <div class="prop-value">${positionLabel}</div>
        </div>
        <div class="prop-section">
          <div class="prop-label">Label</div>
          <input type="text" id="prop-guide-label" value="${escapeHtml(guide.label)}" placeholder="(empty)" style="width: 100%; box-sizing: border-box;" ${locked ? 'disabled' : ''} />
        </div>
        ${locked ? '' : `
        <div class="prop-section">
          <button id="prop-guide-delete" class="snap-preset-btn" title="Delete this guide">Delete Guide</button>
        </div>`}
      `;
      if (setHtmlIfChanged(container, html) && !locked) {
        const labelInput = container.querySelector('#prop-guide-label') as HTMLInputElement;
        labelInput.addEventListener('change', () => {
          history.snapshot();
          store.updateGuide(guideId, { label: labelInput.value });
        });
        labelInput.addEventListener('keydown', (e) => {
          // Mirror comp-name pattern: Enter commits + blurs, Escape reverts + blurs.
          if (e.key === 'Enter') {
            e.preventDefault();
            labelInput.blur();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            labelInput.value = store.getComposition().guides.find(g => g.id === guideId)?.label ?? '';
            labelInput.blur();
          }
        });
        container.querySelector('#prop-guide-delete')?.addEventListener('click', () => {
          history.snapshot();
          store.removeGuide(guideId);
        });
      }
      return;
    }
  }

  const track = comp.tracks.find(t => t.id === state.selectedTrackId);
  if (!track) {
    setHtmlIfChanged(container, '<p class="placeholder-text">No track selected</p>');
    return;
  }
  const trackId = track.id;

  const singleCurveId = store.getSelectedCurveId();
  const curve = singleCurveId ? track.curves.find(c => c.id === singleCurveId) : null;
  if (!curve || state.selectedPointIndex === null) {
    // Show track info — and a CURVE subsection with a "Move to track" picker
    // when the selection forms a single movable unit (8.2).
    const tone = comp.toneLibrary.find(t => t.id === track.toneId);
    const color = escapeHtml(tone?.color ?? '#888');
    const movable = getMovableSelection(state);
    const otherTracks = movable ? comp.tracks.filter(t => t.id !== track.id) : [];
    const moveOptionsHtml = movable
      ? [
          `<option value="" disabled selected>-- Select --</option>`,
          ...otherTracks.map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`),
          ...(otherTracks.length > 0 ? ['<option disabled>──────────</option>'] : []),
          `<option value="${NEW_TRACK_VALUE}">+ New track</option>`,
        ].join('')
      : '';
    const curveSectionHtml = movable
      ? `
      <div class="panel-header">Curve</div>
      <div class="prop-section">
        <div class="prop-label">${movable.curveIds.length > 1 ? `Group (${movable.curveIds.length} curves)` : 'Curve'}</div>
      </div>
      <div class="prop-section">
        <div class="prop-label">Move to track</div>
        <select id="prop-move-track" data-curve-ids="${escapeHtml(movable.curveIds.join(','))}" style="width: 100%; box-sizing: border-box;">${moveOptionsHtml}</select>
      </div>
      <div class="panel-header" style="margin-top:8px">Track</div>`
      : '';
    // The volume slider's value and readout are filled in below, not here.
    const html = `
      ${curveSectionHtml}
      <div class="prop-section">
        <div class="prop-label">Track</div>
        <div class="prop-value">${escapeHtml(track.name)}</div>
      </div>
      <div class="prop-section">
        <div class="prop-label">Tone</div>
        <div class="prop-value prop-tone-clickable" id="prop-tone-name" style="color:${color}" title="Click to change tone">${escapeHtml(tone?.name ?? '?')}</div>
      </div>
      <div class="prop-section">
        <div class="prop-label">Curves</div>
        <div class="prop-value">${track.curves.length}</div>
      </div>
      <div class="prop-section">
        <div class="prop-label">Track Volume</div>
        <input type="range" id="prop-track-vol" data-track-id="${escapeHtml(trackId)}" min="0" max="1" step="0.05" />
        <span class="prop-val-text"></span>
      </div>
      <p class="placeholder-text" style="margin-top:12px">Select a point to edit its properties</p>
    `;

    if (setHtmlIfChanged(container, html)) {
      const moveSelect = container.querySelector('#prop-move-track') as HTMLSelectElement | null;
      moveSelect?.addEventListener('change', () => {
        const target = moveSelect.value;
        if (!target) return;
        const ids = (moveSelect.dataset.curveIds ?? '').split(',').filter(Boolean);
        history.snapshot();
        if (target === NEW_TRACK_VALUE) {
          store.moveCurvesToNewTrack(ids);
        } else {
          store.moveCurvesToTrack(ids, target);
        }
        // Re-render will replace this panel; no need to reset the dropdown.
      });

      const volSlider = container.querySelector('#prop-track-vol') as HTMLInputElement;
      volSlider.addEventListener('mousedown', () => {
        history.snapshot();
      });
      volSlider.addEventListener('input', () => {
        const v = Number(volSlider.value);
        store.mutate(() => {
          const t = liveTrack(trackId);
          if (t) t.volume = v;
        });
      });

      container.querySelector('#prop-tone-name')?.addEventListener('click', (e) => {
        const el = e.target as HTMLElement;
        const t = liveTrack(trackId);
        if (!t) return;
        openTonePicker(store.getComposition().toneLibrary, t.toneId, el).then(picked => {
          if (!picked) return;
          history.snapshot();
          store.mutate(() => {
            const live = liveTrack(trackId);
            if (live) live.toneId = picked.id;
          });
        });
      });
    }

    // Sync the live-edited value every run (undo, redo, other edits). Setting
    // a slider being dragged to its own current value is harmless.
    const volSlider = container.querySelector('#prop-track-vol') as HTMLInputElement | null;
    const volText = container.querySelector('.prop-val-text');
    if (volSlider && Number(volSlider.value) !== track.volume) volSlider.value = String(track.volume);
    const volLabel = track.volume.toFixed(2);
    if (volText && volText.textContent !== volLabel) volText.textContent = volLabel;
    return;
  }

  const point = pitchPoints(curve)[state.selectedPointIndex];
  if (!point) {
    setHtmlIfChanged(container, '<p class="placeholder-text">Invalid selection</p>');
    return;
  }

  const nearestLine = Math.round(point.position.y / CENTS_PER_SEMITONE) * CENTS_PER_SEMITONE;
  const noteName = centsToNoteName(point.position.y);
  const cents = Math.round(point.position.y - nearestLine);

  setHtmlIfChanged(container, `
    <div class="prop-section">
      <div class="prop-label">Point ${state.selectedPointIndex + 1} of ${pitchPoints(curve).length}</div>
    </div>
    <div class="prop-section">
      <div class="prop-label">Time (beats)</div>
      <div class="prop-value">${point.position.x.toFixed(3)}</div>
    </div>
    <div class="prop-section">
      <div class="prop-label">Pitch</div>
      <div class="prop-value">${noteName}${cents !== 0 ? ` ${cents > 0 ? '+' : ''}${cents}ct` : ''}</div>
      <div class="prop-value-sub">${point.position.y.toFixed(1)} ¢</div>
    </div>
    <div class="prop-section">
      <div class="prop-label">Handle In</div>
      <div class="prop-value">${point.handleIn ? `(${point.handleIn.x.toFixed(2)}, ${point.handleIn.y.toFixed(2)})` : 'none'}</div>
    </div>
    <div class="prop-section">
      <div class="prop-label">Handle Out</div>
      <div class="prop-value">${point.handleOut ? `(${point.handleOut.x.toFixed(2)}, ${point.handleOut.y.toFixed(2)})` : 'none'}</div>
    </div>
  `);
}
