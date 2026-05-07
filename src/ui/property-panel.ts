import { store } from '../state/store';
import { history } from '../state/history';
import { noteNumberToName } from '../constants';
import { setPointVolume } from '../model/curve';
import { getMovableSelection } from '../model/curve-groups';
import { openTonePicker } from './tone-picker';

/**
 * Render the property panel contents based on current selection.
 */
export function renderPropertyPanel(container: HTMLElement): void {
  const state = store.getState();
  const comp = state.composition;

  // Selected guide takes precedence over track/curve/point — guide selection is
  // mutually exclusive with curve/point selection per setSelectedGuide / setSelectedCurve.
  if (state.selectedGuideId) {
    const guide = comp.guides.find(g => g.id === state.selectedGuideId);
    if (guide) {
      const positionLabel = guide.orientation === 'x'
        ? `${guide.position.toFixed(3)} beats`
        : `${noteNumberToName(Math.round(guide.position))} (MIDI ${guide.position.toFixed(2)})`;
      // Locked guides become read-only in the property panel — the input is
      // disabled and the Delete button hidden. Lock toggle in the Snap section
      // is the way out.
      const locked = state.guidesLocked;
      container.innerHTML = `
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
          <input type="text" id="prop-guide-label" value="${escapeAttr(guide.label)}" placeholder="(empty)" style="width: 100%; box-sizing: border-box;" ${locked ? 'disabled' : ''} />
        </div>
        ${locked ? '' : `
        <div class="prop-section">
          <button id="prop-guide-delete" class="snap-preset-btn" title="Delete this guide">Delete Guide</button>
        </div>`}
      `;
      const labelInput = container.querySelector('#prop-guide-label') as HTMLInputElement;
      if (!locked) {
        labelInput.addEventListener('change', () => {
          history.snapshot();
          store.updateGuide(guide.id, { label: labelInput.value });
        });
        labelInput.addEventListener('keydown', (e) => {
          // Mirror comp-name pattern: Enter commits + blurs, Escape reverts + blurs.
          if (e.key === 'Enter') {
            e.preventDefault();
            labelInput.blur();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            labelInput.value = guide.label;
            labelInput.blur();
          }
        });
        container.querySelector('#prop-guide-delete')?.addEventListener('click', () => {
          history.snapshot();
          store.removeGuide(guide.id);
        });
      }
      return;
    }
  }

  const track = comp.tracks.find(t => t.id === state.selectedTrackId);
  if (!track) {
    container.innerHTML = '<p class="placeholder-text">No track selected</p>';
    return;
  }

  const singleCurveId = store.getSelectedCurveId();
  const curve = singleCurveId ? track.curves.find(c => c.id === singleCurveId) : null;
  if (!curve || state.selectedPointIndex === null) {
    // Show track info — and a CURVE subsection with a "Move to track" picker
    // when the selection forms a single movable unit (8.2).
    const tone = comp.toneLibrary.find(t => t.id === track.toneId);
    const movable = getMovableSelection(state);
    const NEW_TRACK_VALUE = '__new__';
    const otherTracks = movable ? comp.tracks.filter(t => t.id !== track.id) : [];
    const moveOptionsHtml = movable
      ? [
          `<option value="" disabled selected>-- Select --</option>`,
          ...otherTracks.map(t => `<option value="${escapeAttr(t.id)}">${escapeAttr(t.name)}</option>`),
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
        <select id="prop-move-track" style="width: 100%; box-sizing: border-box;">${moveOptionsHtml}</select>
      </div>
      <div class="panel-header" style="margin-top:8px">Track</div>`
      : '';
    container.innerHTML = `
      ${curveSectionHtml}
      <div class="prop-section">
        <div class="prop-label">Track</div>
        <div class="prop-value">${track.name}</div>
      </div>
      <div class="prop-section">
        <div class="prop-label">Tone</div>
        <div class="prop-value prop-tone-clickable" id="prop-tone-name" style="color:${tone?.color ?? '#888'}" title="Click to change tone">${tone?.name ?? '?'}</div>
      </div>
      <div class="prop-section">
        <div class="prop-label">Curves</div>
        <div class="prop-value">${track.curves.length}</div>
      </div>
      <div class="prop-section">
        <div class="prop-label">Track Volume</div>
        <input type="range" id="prop-track-vol" min="0" max="1" step="0.05" value="${track.volume}" />
        <span class="prop-val-text">${track.volume.toFixed(2)}</span>
      </div>
      <p class="placeholder-text" style="margin-top:12px">Select a point to edit its properties</p>
    `;

    if (movable) {
      const moveSelect = container.querySelector('#prop-move-track') as HTMLSelectElement;
      moveSelect.addEventListener('change', () => {
        const target = moveSelect.value;
        if (!target) return;
        const ids = movable.curveIds;
        history.snapshot();
        if (target === NEW_TRACK_VALUE) {
          store.moveCurvesToNewTrack(ids);
        } else {
          store.moveCurvesToTrack(ids, target);
        }
        // Re-render will replace this panel; no need to reset the dropdown.
      });
    }

    container.querySelector('#prop-track-vol')?.addEventListener('mousedown', () => {
      history.snapshot();
    });
    container.querySelector('#prop-track-vol')?.addEventListener('input', (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      store.mutate(() => { track.volume = v; });
      const span = container.querySelector('.prop-val-text');
      if (span) span.textContent = v.toFixed(2);
    });

    container.querySelector('#prop-tone-name')?.addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      openTonePicker(comp.toneLibrary, track.toneId, el).then(picked => {
        if (picked) {
          history.snapshot();
          store.mutate(() => { track.toneId = picked.id; });
        }
      });
    });
    return;
  }

  const point = curve.points[state.selectedPointIndex];
  if (!point) {
    container.innerHTML = '<p class="placeholder-text">Invalid selection</p>';
    return;
  }

  const noteNum = Math.round(point.position.y);
  const noteName = noteNumberToName(noteNum);
  const cents = Math.round((point.position.y - noteNum) * 100);

  container.innerHTML = `
    <div class="prop-section">
      <div class="prop-label">Point ${state.selectedPointIndex + 1} of ${curve.points.length}</div>
    </div>
    <div class="prop-section">
      <div class="prop-label">Time (beats)</div>
      <div class="prop-value">${point.position.x.toFixed(3)}</div>
    </div>
    <div class="prop-section">
      <div class="prop-label">Pitch</div>
      <div class="prop-value">${noteName}${cents !== 0 ? ` ${cents > 0 ? '+' : ''}${cents}ct` : ''}</div>
      <div class="prop-value-sub">MIDI ${point.position.y.toFixed(2)}</div>
    </div>
    <div class="prop-section">
      <div class="prop-label">Volume</div>
      <input type="range" id="prop-vol" min="0" max="1" step="0.05" value="${point.volume}" />
      <span class="prop-val-text">${point.volume.toFixed(2)}</span>
    </div>
    <div class="prop-section">
      <div class="prop-label">Handle In</div>
      <div class="prop-value">${point.handleIn ? `(${point.handleIn.x.toFixed(2)}, ${point.handleIn.y.toFixed(2)})` : 'none'}</div>
    </div>
    <div class="prop-section">
      <div class="prop-label">Handle Out</div>
      <div class="prop-value">${point.handleOut ? `(${point.handleOut.x.toFixed(2)}, ${point.handleOut.y.toFixed(2)})` : 'none'}</div>
    </div>
  `;

  container.querySelector('#prop-vol')?.addEventListener('mousedown', () => {
    history.snapshot();
  });
  container.querySelector('#prop-vol')?.addEventListener('input', (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    store.mutate(() => {
      setPointVolume(curve, state.selectedPointIndex!, v);
    });
    const span = container.querySelector('.prop-val-text');
    if (span) span.textContent = v.toFixed(2);
  });
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]!));
}
