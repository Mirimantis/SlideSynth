import { store } from '../state/store';
import { noteNumberToName } from '../constants';
import { setPointVolume } from '../model/curve';

/**
 * Render the property panel contents based on current selection.
 */
export function renderPropertyPanel(container: HTMLElement): void {
  const state = store.getState();
  const comp = state.composition;

  const track = comp.tracks.find(t => t.id === state.selectedTrackId);
  if (!track) {
    container.innerHTML = '<p class="placeholder-text">No track selected</p>';
    return;
  }

  const curve = track.curves.find(c => c.id === state.selectedCurveId);
  if (!curve || state.selectedPointIndex === null) {
    // Show track info
    const tone = comp.toneLibrary.find(t => t.id === track.toneId);
    container.innerHTML = `
      <div class="prop-section">
        <div class="prop-label">Track</div>
        <div class="prop-value">${track.name}</div>
      </div>
      <div class="prop-section">
        <div class="prop-label">Tone</div>
        <div class="prop-value" style="color:${tone?.color ?? '#888'}">${tone?.name ?? '?'}</div>
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

    container.querySelector('#prop-track-vol')?.addEventListener('input', (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      store.mutate(() => { track.volume = v; });
      const span = container.querySelector('.prop-val-text');
      if (span) span.textContent = v.toFixed(2);
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

  container.querySelector('#prop-vol')?.addEventListener('input', (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    store.mutate(() => {
      setPointVolume(curve, state.selectedPointIndex!, v);
    });
    const span = container.querySelector('.prop-val-text');
    if (span) span.textContent = v.toFixed(2);
  });
}
