import '@preact/signals'; // components re-render when the store fields they read change
import { store } from '../state/store';
import { primaryShortcut } from '../commands/catalog';
import { DYNAMICS_SOURCES, type DynamicsSource } from '../types';
import { MOVE_INTERVALS, isTwelveEdo, moveIntervalName } from '../tuning/tuning';
import { NUDGE_SIZE_MAX, NUDGE_SIZE_MIN } from '../model/nudge';
import { RECORD_ACCURACY_STEPS } from '../model/fit';

/**
 * Tool (BACKLOG 15.4; was Tool Properties until 16.5): the active tool's settings, or Perform's. A
 * Preact component, so the handle-length slider can be dragged while the panel
 * re-renders around it.
 */
export function ToolPropertyPanel() {
  const st = store.getState();
  if (st.performMode) return <PerformSettings source={st.dynamicsSource} legacy={st.recordFitLegacy} />;
  if (st.activeTool === 'select') return <SelectSettings />;
  if (st.activeTool === 'nudge') return <NudgeSettings />;
  if (st.activeTool !== 'draw') return <p class="placeholder-text">No settings for this tool</p>;

  const mode = st.drawPreviewMode;
  const ratio = st.autoSmoothXRatio;
  return (
    <>
      <div class="prop-section">
        <div class="prop-label">Draw Preview</div>
        <label class="prop-radio">
          <input type="radio" name="draw-preview-mode" value="tone" checked={mode === 'tone'}
            onChange={() => store.setDrawPreviewMode('tone')} /> Tone only
        </label>
        <label class="prop-radio">
          <input type="radio" name="draw-preview-mode" value="composition" checked={mode === 'composition'}
            onChange={() => store.setDrawPreviewMode('composition')} /> Composition + tone
        </label>
      </div>
      <div class="prop-section">
        <label class="prop-radio">
          <input type="checkbox" id="draw-auto-smooth" checked={st.bezierAutoSmooth}
            onChange={e => store.setBezierAutoSmooth((e.currentTarget as HTMLInputElement).checked)} /> Bezier Auto-Smoothing
        </label>
        <div
          class="prop-slider-row"
          title={`Handle length as fraction of the neighbor segment's X distance. Shared by Auto-Smoothing and the Smooth Curve action (${primaryShortcut('edit.smooth')}).`}
        >
          <label for="auto-smooth-ratio">Handle length</label>
          <input
            type="range"
            id="auto-smooth-ratio"
            class="auto-smooth-ratio-slider"
            min="0"
            max="1"
            step="0.05"
            value={ratio}
            onInput={e => store.setAutoSmoothXRatio(Number((e.currentTarget as HTMLInputElement).value))}
          />
          <span class="auto-smooth-ratio-value">{ratio.toFixed(2)}</span>
        </div>
      </div>
    </>
  );
}

/** The Nudge brush (13.26): Push or Smooth, which way it moves, its size,
 *  and how hard Smooth rubs. */
function NudgeSettings() {
  const st = store.getState();
  const radio = <T extends string>(name: string, value: T, current: T, label: string, set: (v: T) => void, title: string) => (
    <label class="prop-radio" title={title}>
      <input type="radio" name={name} value={value} checked={current === value} onChange={() => set(value)} /> {label}
    </label>
  );
  return (
    <>
      <div class="prop-section">
        <div class="prop-label">Mode</div>
        {radio('nudge-mode', 'push', st.nudgeMode, 'Push', m => store.setNudgeMode(m),
          'Drag to move an area of the curve: points at the cursor move fully, fading out to the brush’s edge')}
        {radio('nudge-mode', 'smooth', st.nudgeMode, 'Smooth', m => store.setNudgeMode(m),
          'Rub back and forth to even out the area under the brush: wobble in pitch, uneven spacing in time')}
      </div>
      <div class="prop-section">
        <div class="prop-label">Moves</div>
        {radio('nudge-axes', 'pitch', st.nudgeAxes, 'Pitch', a => store.setNudgeAxes(a), 'Points move only in pitch; their timing stays')}
        {radio('nudge-axes', 'time', st.nudgeAxes, 'Time', a => store.setNudgeAxes(a), 'Points move only in time, never passing each other')}
        {radio('nudge-axes', 'both', st.nudgeAxes, 'Both', a => store.setNudgeAxes(a), 'Points move in pitch and time; hold Shift to lock a drag to one')}
      </div>
      <div class="prop-section">
      <div class="prop-slider-row" title={`How far the brush reaches each side of the cursor, in screen pixels (${primaryShortcut('nudge.smaller')} / ${primaryShortcut('nudge.larger')})`}>
        <label for="nudge-size">Size</label>
        <input
          type="range" id="nudge-size" class="auto-smooth-ratio-slider"
          min={NUDGE_SIZE_MIN} max={NUDGE_SIZE_MAX} step="1" value={st.nudgeSize}
          onInput={e => store.setNudgeSize(Number((e.currentTarget as HTMLInputElement).value))}
        />
        <span class="auto-smooth-ratio-value">{st.nudgeSize}px</span>
      </div>
      {st.nudgeMode === 'smooth' && (
        <div class="prop-slider-row" title="How much each rub evens out the points under the brush">
          <label for="nudge-strength">Strength</label>
          <input
            type="range" id="nudge-strength" class="auto-smooth-ratio-slider"
            min="0.05" max="1" step="0.05" value={st.nudgeStrength}
            onInput={e => store.setNudgeStrength(Number((e.currentTarget as HTMLInputElement).value))}
          />
          <span class="auto-smooth-ratio-value">{st.nudgeStrength.toFixed(2)}</span>
        </div>
      )}
      </div>
      <p class="placeholder-text">Never snaps. One undo step per stroke.</p>
    </>
  );
}

/** How closely takes are fitted, and Simplify refits (13.11): one pref, shown
 *  in Perform's settings and Select's. */
function AccuracySlider() {
  const accuracy = store.getState().recordAccuracy;
  const index = Math.max(0, RECORD_ACCURACY_STEPS.indexOf(accuracy));
  return (
    <div class="prop-section">
      <div
        class="prop-slider-row"
        title={`The most a recorded take may be off what you played, in cents. Tight keeps small vibrato; loose irons it out with fewer points. Simplify (${primaryShortcut('edit.simplify')}) refits to it too`}
      >
        <label for="record-accuracy">Accuracy</label>
        <input
          type="range" id="record-accuracy" class="auto-smooth-ratio-slider"
          min="0" max={RECORD_ACCURACY_STEPS.length - 1} step="1" value={index}
          onInput={e => store.setRecordAccuracy(RECORD_ACCURACY_STEPS[Number((e.currentTarget as HTMLInputElement).value)] ?? accuracy)}
        />
        <span class="auto-smooth-ratio-value">{accuracy}¢</span>
      </div>
    </div>
  );
}

/** Select's settings: what the transform box's arrows move by (13.24), and
 *  Simplify's Accuracy (13.11). */
function SelectSettings() {
  const st = store.getState();
  // One step is a semitone in 12-EDO, the same as Minor 2nd.
  const intervals = isTwelveEdo(st.tuning) && st.moveInterval !== 0 ? MOVE_INTERVALS.filter(i => i !== 0) : MOVE_INTERVALS;
  return (
    <>
    <div class="prop-section">
      <div class="prop-label">Move by</div>
      <select
        id="move-interval"
        title={`What the transform box's arrows (and ${primaryShortcut('edit.moveUp')} / ${primaryShortcut('edit.moveDown')}) move the selection by, counted in the tuning from each curve's own note. Alt+click an arrow (or ${primaryShortcut('edit.copyUp')} / ${primaryShortcut('edit.copyDown')}) moves a copy: a harmony line`}
        value={String(st.moveInterval)}
        onChange={e => {
          store.setMoveInterval(Number((e.currentTarget as HTMLSelectElement).value));
          (e.currentTarget as HTMLElement).blur();
        }}
      >
        {intervals.map(i => <option key={i} value={String(i)}>{moveIntervalName(i, st.tuning)}</option>)}
      </select>
    </div>
    <AccuracySlider />
    </>
  );
}

/** Perform's settings (BACKLOG 16.3, moved from the old Transport drawer):
 *  what sets the volume of what you play. The Perform session (16.8) gives it
 *  a clearer name. */
function PerformSettings({ source, legacy }: { source: DynamicsSource; legacy: boolean }) {
  return (
    <>
    <div class="prop-section">
      <div class="prop-label">Dynamics</div>
      <select
        id="perform-dynamics-source"
        title="What sets the volume of what you perform"
        value={source}
        onChange={e => {
          const value = (e.currentTarget as HTMLSelectElement).value as DynamicsSource;
          if (DYNAMICS_SOURCES.includes(value)) store.setDynamicsSource(value);
        }}
      >
        <option value="fixed">Fixed</option>
        <option value="key-swell">Key swell (hold F)</option>
      </select>
    </div>
    <AccuracySlider />
    {/* 13.11: kept for comparison while the new fit settles; its removal is
        decided before 16.8 or 17.1 (see BACKLOG 13.11). */}
    <div class="prop-section">
      <label class="prop-radio" title="Testing: record with the old fit (RDP, flat handles) to compare">
        <input type="checkbox" id="record-fit-legacy" checked={legacy}
          onChange={e => store.setRecordFitLegacy((e.currentTarget as HTMLInputElement).checked)} /> Old fit (testing)
      </label>
    </div>
    </>
  );
}
