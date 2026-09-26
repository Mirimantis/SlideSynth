import '@preact/signals'; // components re-render when the store fields they read change
import type { ReadonlySignal } from '@preact/signals';
import { useState } from 'preact/hooks';
import { store } from '../state/store';
import { commandSpec, commandTitle, primaryShortcut, type CommandId } from '../commands/catalog';
import type { CommandRegistry } from '../commands/registry';
import { isCapturing, isRolling, passRecordState } from '../state/transport';
import { getCompositionLength } from '../model/composition';
import { Icon } from './icon';
import { CommandButton } from './command-button';
import { MenuBar, MenuButton, type MenuEntry, type MenuSpec } from './menu';
import iconPlay from '../assets/icons/play.svg?raw';
import iconPause from '../assets/icons/pause.svg?raw';
import iconStop from '../assets/icons/stop.svg?raw';
import iconRecord from '../assets/icons/record.svg?raw';
import iconKeep from '../assets/icons/keep.svg?raw';
import iconSnap from '../assets/icons/snap.svg?raw';
import iconLoop from '../assets/icons/loop.svg?raw';
import iconUndo from '../assets/icons/undo.svg?raw';
import iconRedo from '../assets/icons/redo.svg?raw';
import iconSettings from '../assets/icons/settings.svg?raw';

/**
 * The top bar (BACKLOG 16.3), left to right: the composition's name and
 * length, the File / Edit / View menus and Undo / Redo; the transport, the
 * Snap and Loop switches, and Settings. (Perform moved to the tool strip in
 * 16.4.) Tempo and the metronome live in the Tempo drawer instead — they're
 * set once per project.
 *
 * Every button runs a command, so it does exactly what its key does. Small
 * components, each reading only what it shows, so a drag that changes the
 * composition re-renders the length and nothing else.
 */
export interface TopBarProps {
  commands: CommandRegistry;
  menus: readonly MenuSpec[];
  canUndo: ReadonlySignal<boolean>;
  canRedo: ReadonlySignal<boolean>;
  /** Phrases the rolling buffer can keep. Engine state, polled per frame. */
  keepable: ReadonlySignal<number>;
}

/** What the Record button's menu holds. */
export const RECORD_MENU: readonly MenuEntry[] = [
  'transport.recordPass', 'perform.dropPass', '-', 'transport.layerMode', 'transport.countIn',
];

export function TopBar({ commands, menus, canUndo, canRedo, keepable }: TopBarProps) {
  return (
    <>
      <div class="toolbar-row" id="toolbar-left">
        <div class="toolbar-group">
          <CompositionName />
          <CompositionLength />
        </div>
        <MenuBar menus={menus} commands={commands} />
        <div class="toolbar-group">
          <HistoryButton id="edit.undo" svg={iconUndo} commands={commands} can={canUndo} />
          <HistoryButton id="edit.redo" svg={iconRedo} commands={commands} can={canRedo} />
        </div>
      </div>
      <div class="toolbar-zone right">
        <Transport commands={commands} keepable={keepable} />
        <div class="toolbar-toggles">
          <SnapToggle commands={commands} />
          <LoopToggle commands={commands} />
        </div>
        <CommandButton id="app.settings" commands={commands} class="icon-toggle settings-btn">
          <Icon svg={iconSettings} />
        </CommandButton>
      </div>
    </>
  );
}

function CompositionName() {
  const stored = store.getState().composition.name || 'Untitled';
  // What's being typed, until Enter or leaving the field commits it.
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (value: string) => {
    store.mutate(c => { c.name = value.trim() || 'Untitled'; });
    setDraft(null);
  };
  return (
    <input
      type="text"
      id="comp-name"
      class="comp-name-input"
      title="Composition name"
      spellcheck={false}
      value={draft ?? stored}
      onInput={e => setDraft((e.currentTarget as HTMLInputElement).value)}
      onChange={e => commit((e.currentTarget as HTMLInputElement).value)}
      onKeyDown={e => {
        const input = e.currentTarget as HTMLInputElement;
        if (e.key === 'Enter') {
          e.preventDefault();
          input.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setDraft(null);
          input.value = stored;
          input.blur();
        }
      }}
    />
  );
}

/** "M:SS", from the rightmost point at the composition's tempo. */
export function formatLengthMMSS(lengthBeats: number, bpm: number): string {
  const seconds = bpm > 0 ? lengthBeats * 60 / bpm : 0;
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${min}:${String(sec).padStart(2, '0')}`;
}

function CompositionLength() {
  const comp = store.getState().composition;
  return (
    <span id="comp-length" class="comp-length-display" title="Composition length (derived from last point)">
      {formatLengthMMSS(getCompositionLength(comp), comp.bpm)}
    </span>
  );
}

function HistoryButton({ id, svg, commands, can }: {
  id: CommandId; svg: string; commands: CommandRegistry; can: ReadonlySignal<boolean>;
}) {
  return (
    <CommandButton id={id} commands={commands} class="icon-toggle history-btn" disabled={!can.value}>
      <Icon svg={svg} />
    </CommandButton>
  );
}

function Transport({ commands, keepable }: { commands: CommandRegistry; keepable: ReadonlySignal<number> }) {
  const st = store.getState();
  const t = st.transport;
  const rolling = isRolling(t);
  const noTrack = st.selectedTrackId === null;
  const pass = passRecordState(t);
  const recordClass = [
    'record-btn',
    pass === 'queued' ? 'queued' : '',
    t.mode === 'countdown' ? 'armed' : '',
    isCapturing(t) ? 'recording' : '',
  ].filter(Boolean).join(' ');
  const keep = keepable.value;
  return (
    <div class="transport-buttons transport">
      <CommandButton id="transport.stop" commands={commands}>
        <Icon svg={iconStop} />
      </CommandButton>
      <CommandButton
        id={rolling ? 'transport.pause' : 'transport.play'}
        commands={commands}
        class="play-pause-btn"
        title={`${commandSpec(rolling ? 'transport.pause' : 'transport.play').label} (${primaryShortcut('transport.playPause')})`}
      >
        <Icon svg={rolling ? iconPause : iconPlay} />
      </CommandButton>
      <div class="split-btn">
        <button
          class={recordClass}
          title={`${commandTitle('transport.record')}. Shift+click records one loop pass.`}
          aria-label="Record"
          disabled={noTrack}
          onClick={e => {
            (e.currentTarget as HTMLElement).blur();
            commands.run(e.shiftKey ? 'transport.recordPass' : 'transport.record');
          }}
        >
          <Icon svg={iconRecord} />
        </button>
        <MenuButton entries={RECORD_MENU} commands={commands} class="split-btn-caret" title="Recording options">
          ▾
        </MenuButton>
      </div>
      <CommandButton
        id="perform.keep"
        commands={commands}
        class={`keep-btn${keep > 0 ? ' keepable' : ''}`}
        title={keep > 0 ? `${commandTitle('perform.keep')} (${keep} keepable)` : commandTitle('perform.keep')}
        disabled={keep === 0 || noTrack}
      >
        <Icon svg={iconKeep} />
      </CommandButton>
    </div>
  );
}

function SnapToggle({ commands }: { commands: CommandRegistry }) {
  return (
    <CommandButton id="snap.toggle" commands={commands} class="icon-toggle" pressed={store.getState().snapEnabled}>
      <Icon svg={iconSnap} />
    </CommandButton>
  );
}

function LoopToggle({ commands }: { commands: CommandRegistry }) {
  const st = store.getState();
  return (
    <CommandButton
      id="transport.loop"
      commands={commands}
      class="icon-toggle"
      pressed={st.loopEnabled}
      // The loop defines what's being recorded, so it holds still meanwhile.
      disabled={isCapturing(st.transport)}
    >
      <Icon svg={iconLoop} />
    </CommandButton>
  );
}
