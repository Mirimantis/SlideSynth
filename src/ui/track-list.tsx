import '@preact/signals'; // components re-render when the store fields they read change
import { store } from '../state/store';
import type { Track } from '../types';
import { Icon } from './icon';
import { ActionMenuButton } from './menu';
import iconMute from '../assets/icons/mute.svg?raw';
import iconSolo from '../assets/icons/solo.svg?raw';
import iconMidi from '../assets/icons/midi.svg?raw';
import iconGuide from '../assets/icons/guide.svg?raw';
import iconEye from '../assets/icons/eye.svg?raw';
import iconEyeOff from '../assets/icons/eye-off.svg?raw';

/**
 * The track list (BACKLOG 15.4). Each row: colour, name and tone (click for
 * the tone picker); Mute, Solo and MIDI arm as icon toggles; and a ⋯ menu
 * with Edit tone and Delete (16.5). A Preact component: it reads the store while
 * rendering, so it re-renders when those fields change, and Preact updates
 * only the DOM that differs. The actions that reach beyond the store (MIDI
 * voices, layer bookkeeping, dialogs, the transform box) come from main.ts.
 */
export interface TrackListActions {
  /** Make the track active and select its curves. */
  select(trackId: string): void;
  toggleMute(trackId: string): void;
  toggleSolo(trackId: string): void;
  /** A guide track's curves are silent pitch guides (13.10). */
  toggleGuide(trackId: string): void;
  /** Hidden: not drawn or pickable, and a hidden guide doesn't pull. */
  toggleHidden(trackId: string): void;
  toggleMidiArm(trackId: string): void;
  editTone(trackId: string): void;
  pickTone(trackId: string, anchor: HTMLElement): void;
  remove(trackId: string): void;
}

export function TrackList({ actions }: { actions: TrackListActions }) {
  const st = store.getState();
  const comp = st.composition;
  return (
    <>
      {comp.tracks.map(track => {
        const tone = comp.toneLibrary.find(t => t.id === track.toneId);
        const midiArmed = st.midiArmedTrackId === track.id;
        const midiRecording = midiArmed && st.performance.planchettes.some(
          p => p.voiceId.startsWith('midi-') && p.trackId === track.id,
        );
        return (
          <TrackRow
            key={track.id}
            track={track}
            color={tone?.color ?? 'var(--tone-fallback)'}
            toneName={tone?.name ?? '?'}
            selected={track.id === st.selectedTrackId}
            midiArm={midiRecording ? 'recording' : midiArmed ? 'armed' : ''}
            actions={actions}
          />
        );
      })}
    </>
  );
}

interface TrackRowProps {
  track: Track;
  color: string;
  toneName: string;
  selected: boolean;
  midiArm: '' | 'armed' | 'recording';
  actions: TrackListActions;
}

function TrackRow({ track, color, toneName, selected, midiArm, actions }: TrackRowProps) {
  // Handlers pass the id, never the track object: the actions look the track
  // up when they run, since an undo swaps in new objects.
  const id = track.id;
  /** A control inside the row: act, and don't also select the row. */
  const control = (run: (e: MouseEvent) => void) => (e: MouseEvent) => {
    e.stopPropagation();
    run(e);
  };
  return (
    <div
      class={`track-item${selected ? ' selected' : ''}${track.muted ? ' muted' : ''}${track.guide ? ' guide' : ''}${track.hidden ? ' hidden' : ''}`}
      data-track-id={id}
      onClick={() => actions.select(id)}
    >
      <div class="track-color" style={{ background: color }} />
      <div class="track-info">
        <span class="track-name">{track.name}</span>
        <span
          class="track-tone tone-name-clickable"
          style={{ color }}
          title="Click to change tone"
          onClick={control(e => actions.pickTone(id, e.currentTarget as HTMLElement))}
        >
          {toneName}
        </span>
      </div>
      <div class="track-controls" onClick={e => e.stopPropagation()}>
        <button
          class={`track-btn track-mute${track.muted ? ' active' : ''}`}
          title={track.guide ? 'A guide track is always silent' : track.muted ? 'Unmute' : 'Mute: silent, but still shown (dimmed) and editable'}
          aria-label="Mute"
          aria-pressed={track.muted}
          disabled={!!track.guide}
          onClick={control(() => actions.toggleMute(id))}
        >
          <Icon svg={iconMute} />
        </button>
        <button
          class={`track-btn track-solo${track.solo ? ' active' : ''}`}
          title={track.guide ? 'A guide track is always silent' : track.solo ? 'Unsolo' : 'Solo'}
          aria-label="Solo"
          aria-pressed={track.solo}
          disabled={!!track.guide}
          onClick={control(() => actions.toggleSolo(id))}
        >
          <Icon svg={iconSolo} />
        </button>
        <button
          class={`track-btn track-hide${track.hidden ? ' active' : ''}`}
          title={track.hidden
            ? 'Show this track'
            : track.guide ? 'Hide this track: its guides aren\'t drawn and don\'t pull' : 'Hide this track: its curves aren\'t drawn or pickable (it still plays)'}
          aria-label="Hide"
          aria-pressed={!!track.hidden}
          onClick={control(() => actions.toggleHidden(id))}
        >
          <Icon svg={track.hidden ? iconEyeOff : iconEye} />
        </button>
        <button
          class={`track-btn track-guide${track.guide ? ' active' : ''}`}
          title={track.guide
            ? 'Guide track: its curves are silent pitch guides that pull like frets. Click to make it sound again'
            : 'Make this a guide track: its curves go silent and pull like frets whose pitch moves (Gravity drawer › Guides shows or hides them)'}
          aria-label="Guide track"
          aria-pressed={!!track.guide}
          onClick={control(() => actions.toggleGuide(id))}
        >
          <Icon svg={iconGuide} />
        </button>
        <button
          class={`track-btn track-midi-arm${midiArm ? ` ${midiArm}` : ''}`}
          title={midiArm ? 'MIDI input armed — click to disarm' : 'Arm this track for MIDI input recording'}
          aria-label="MIDI arm"
          aria-pressed={midiArm !== ''}
          onClick={control(() => actions.toggleMidiArm(id))}
        >
          <Icon svg={iconMidi} />
        </button>
        <ActionMenuButton
          class="track-btn track-more"
          title="More track actions"
          actions={[
            { label: 'Edit tone…', run: () => actions.editTone(id) },
            { label: 'Delete track', run: () => actions.remove(id), danger: true },
          ]}
        >
          ⋯
        </ActionMenuButton>
      </div>
    </div>
  );
}
