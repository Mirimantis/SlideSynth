import '@preact/signals'; // components re-render when the store fields they read change
import { store } from '../state/store';
import { history } from '../state/history';
import { centsToNoteName, CENTS_PER_SEMITONE } from '../constants';
import { anyGrouped, getMovableSelection } from '../model/curve-groups';
import type { CommandRegistry } from '../commands/registry';
import { CommandButton } from './command-button';
import { pitchPoints } from '../model/curve';
import { openTonePicker } from './tone-picker';
import type { BezierCurve, GuideDefinition, Track } from '../types';

const NEW_TRACK_VALUE = '__new__';

function liveTrack(trackId: string): Track | undefined {
  return store.getComposition().tracks.find(t => t.id === trackId);
}

/**
 * Selection (BACKLOG 15.4; was Object Properties until 16.5): the selected
 * guide, the selected point, or the active track, with the selected curves
 * above it — a group says so and offers Ungroup (13.12), and one movable unit
 * gets a Move-to-track picker. A Preact component that reads the store while
 * rendering, so it follows undo, redo and edits made elsewhere. Handlers look
 * state up by id when they run, since an undo swaps in new objects.
 */
export function PropertyPanel({ commands }: { commands: CommandRegistry }) {
  const st = store.getState();
  const comp = st.composition;

  // A selected guide takes precedence (guide and curve selection are exclusive).
  const guide = st.selectedGuideId ? comp.guides.find(g => g.id === st.selectedGuideId) : undefined;
  if (guide) return <GuideProps guide={guide} locked={st.guidesLocked} />;

  const track = comp.tracks.find(t => t.id === st.selectedTrackId);
  if (!track) return <p class="placeholder-text">No track selected</p>;

  const curveId = store.getSelectedCurveId();
  const curve = curveId ? track.curves.find(c => c.id === curveId) : undefined;
  if (curve && st.selectedPointIndex !== null) return <PointProps curve={curve} index={st.selectedPointIndex} />;

  return <TrackProps track={track} commands={commands} />;
}

function GuideProps({ guide, locked }: { guide: GuideDefinition; locked: boolean }) {
  const id = guide.id;
  const position = guide.orientation === 'x'
    ? `${guide.position.toFixed(3)} beats`
    : `${centsToNoteName(guide.position)} (${guide.position.toFixed(1)} ¢)`;
  const savedLabel = () => store.getComposition().guides.find(g => g.id === id)?.label ?? '';
  return (
    <>
      <div class="prop-section">
        <div class="prop-label">Snap Guide{locked ? ' (locked)' : ''}</div>
        <div class="prop-value">{guide.orientation === 'x' ? 'Vertical (beat)' : 'Horizontal (pitch)'}</div>
      </div>
      <div class="prop-section">
        <div class="prop-label">Position</div>
        <div class="prop-value">{position}</div>
      </div>
      <div class="prop-section">
        <div class="prop-label">Label</div>
        {/* Uncontrolled while typing; keyed on the saved label so an undo or
            another edit shows up. Locked guides are read-only here. */}
        <input
          key={`${id}:${guide.label}`}
          type="text"
          id="prop-guide-label"
          defaultValue={guide.label}
          placeholder="(empty)"
          style={{ width: '100%', boxSizing: 'border-box' }}
          disabled={locked}
          onChange={e => {
            history.snapshot();
            store.updateGuide(id, { label: (e.currentTarget as HTMLInputElement).value });
          }}
          onKeyDown={e => {
            // Like the composition name: Enter commits, Escape reverts.
            const input = e.currentTarget as HTMLInputElement;
            if (e.key === 'Enter') {
              e.preventDefault();
              input.blur();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              input.value = savedLabel();
              input.blur();
            }
          }}
        />
      </div>
      {!locked && (
        <div class="prop-section">
          <button
            id="prop-guide-delete"
            class="snap-preset-btn"
            title="Delete this guide"
            onClick={() => {
              history.snapshot();
              store.removeGuide(id);
            }}
          >
            Delete Guide
          </button>
        </div>
      )}
    </>
  );
}

function TrackProps({ track, commands }: { track: Track; commands: CommandRegistry }) {
  const st = store.getState();
  const comp = st.composition;
  const trackId = track.id;
  const tone = comp.toneLibrary.find(t => t.id === track.toneId);
  const selected = track.curves.filter(c => st.selectedCurveIds.has(c.id));
  // 8.2: a selection that forms one movable unit can move to another track.
  const movable = getMovableSelection(st);
  const otherTracks = movable ? comp.tracks.filter(t => t.id !== trackId) : [];
  const grouped = anyGrouped(selected);
  const isOneGroup = !!movable && grouped;

  const moveTo = (target: string) => {
    if (!movable || !target) return;
    history.snapshot();
    if (target === NEW_TRACK_VALUE) store.moveCurvesToNewTrack(movable.curveIds);
    else store.moveCurvesToTrack(movable.curveIds, target);
  };

  const pickTone = (anchor: HTMLElement) => {
    const t = liveTrack(trackId);
    if (!t) return;
    openTonePicker(store.getComposition().toneLibrary, t.toneId, anchor).then(picked => {
      if (!picked) return;
      history.snapshot();
      store.mutate(() => {
        const live = liveTrack(trackId);
        if (live) live.toneId = picked.id;
      });
    });
  };

  return (
    <>
      {selected.length > 0 && (
        <>
          <div class="prop-section prop-selection-line">
            <div class="prop-label">
              {isOneGroup ? `Group of ${selected.length} curves`
                : selected.length === 1 ? 'Curve'
                : `${selected.length} curves${grouped ? ', some grouped' : ''}`}
            </div>
            {grouped && (
              <CommandButton id="edit.ungroup" commands={commands} class="snap-preset-btn prop-ungroup-btn">
                Ungroup
              </CommandButton>
            )}
          </div>
        </>
      )}
      {movable && (
        <>
          <div class="prop-section">
            <div class="prop-label">Move to track</div>
            {/* Always shows "-- Select --": picking moves the curves and the
                re-render resets it. */}
            <select
              id="prop-move-track"
              value=""
              style={{ width: '100%', boxSizing: 'border-box' }}
              onChange={e => moveTo((e.currentTarget as HTMLSelectElement).value)}
            >
              <option value="" disabled>-- Select --</option>
              {otherTracks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              {otherTracks.length > 0 && <option disabled>──────────</option>}
              <option value={NEW_TRACK_VALUE}>+ New track</option>
            </select>
          </div>
        </>
      )}
      {selected.length > 0 && <div class="panel-header" style={{ marginTop: '8px' }}>Track</div>}
      <div class="prop-section">
        <div class="prop-label">Track</div>
        <div class="prop-value">{track.name}</div>
      </div>
      <div class="prop-section">
        <div class="prop-label">Tone</div>
        <div
          class="prop-value prop-tone-clickable"
          id="prop-tone-name"
          style={{ color: tone?.color ?? '#888' }}
          title="Click to change tone"
          onClick={e => pickTone(e.currentTarget as HTMLElement)}
        >
          {tone?.name ?? '?'}
        </div>
      </div>
      <div class="prop-section">
        <div class="prop-label">Curves</div>
        <div class="prop-value">{track.curves.length}</div>
      </div>
      <div class="prop-section">
        <div class="prop-label">Track Volume</div>
        <input
          type="range"
          id="prop-track-vol"
          min="0"
          max="1"
          step="0.05"
          value={track.volume}
          // One undo step per drag.
          onPointerDown={() => history.snapshot()}
          onInput={e => {
            const v = Number((e.currentTarget as HTMLInputElement).value);
            store.mutate(() => {
              const t = liveTrack(trackId);
              if (t) t.volume = v;
            });
          }}
        />
        <span class="prop-val-text">{track.volume.toFixed(2)}</span>
      </div>
      <p class="placeholder-text" style={{ marginTop: '12px' }}>Select a point to edit its properties</p>
    </>
  );
}

function PointProps({ curve, index }: { curve: BezierCurve; index: number }) {
  const points = pitchPoints(curve);
  const point = points[index];
  if (!point) return <p class="placeholder-text">Invalid selection</p>;

  const cents = Math.round(point.position.y - Math.round(point.position.y / CENTS_PER_SEMITONE) * CENTS_PER_SEMITONE);
  const handle = (h: { x: number; y: number } | null) => (h ? `(${h.x.toFixed(2)}, ${h.y.toFixed(2)})` : 'none');
  return (
    <>
      <div class="prop-section">
        <div class="prop-label">Point {index + 1} of {points.length}</div>
      </div>
      <div class="prop-section">
        <div class="prop-label">Time (beats)</div>
        <div class="prop-value">{point.position.x.toFixed(3)}</div>
      </div>
      <div class="prop-section">
        <div class="prop-label">Pitch</div>
        <div class="prop-value">
          {centsToNoteName(point.position.y)}
          {cents !== 0 && ` ${cents > 0 ? '+' : ''}${cents}ct`}
        </div>
        <div class="prop-value-sub">{point.position.y.toFixed(1)} ¢</div>
      </div>
      <div class="prop-section">
        <div class="prop-label">Handle In</div>
        <div class="prop-value">{handle(point.handleIn)}</div>
      </div>
      <div class="prop-section">
        <div class="prop-label">Handle Out</div>
        <div class="prop-value">{handle(point.handleOut)}</div>
      </div>
    </>
  );
}
