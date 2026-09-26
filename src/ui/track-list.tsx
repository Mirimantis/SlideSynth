import '@preact/signals'; // components re-render when the store fields they read change
import { store } from '../state/store';
import type { Track } from '../types';
import { Icon } from './icon';
import { ActionMenuButton } from './menu';
import iconMute from '../assets/icons/mute.svg?raw';
import iconSolo from '../assets/icons/solo.svg?raw';
import iconMidi from '../assets/icons/midi.svg?raw';

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
            color={tone?.color ?? '#888'}
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
      class={`track-item${selected ? ' selected' : ''}${track.muted ? ' muted' : ''}`}
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
          title={track.muted ? 'Unmute' : 'Mute'}
          aria-label="Mute"
          aria-pressed={track.muted}
          onClick={control(() => actions.toggleMute(id))}
        >
          <Icon svg={iconMute} />
        </button>
        <button
          class={`track-btn track-solo${track.solo ? ' active' : ''}`}
          title={track.solo ? 'Unsolo' : 'Solo'}
          aria-label="Solo"
          aria-pressed={track.solo}
          onClick={control(() => actions.toggleSolo(id))}
        >
          <Icon svg={iconSolo} />
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
