import '@preact/signals'; // components re-render when the store fields they read change
import type { ReadonlySignal, Signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { primaryShortcut } from '../commands/catalog';
import type { CommandRegistry } from '../commands/registry';
import { MIN_ZOOM_Y, MAX_ZOOM_Y } from '../constants';
import { Icon } from './icon';
import type { MenuSpec } from './menu';
import { TopBar } from './top-bar';
import { ToolStrip } from './tool-strip';
import { TempoPanel, type TempoActions } from './tempo-panel';
import { SnapPanel, type SnapActions } from './snap-panel';
import { PrismPanel } from './prism-panel';
import { TuningPanel, type TuningActions } from './tuning-panel';
import { PropertyPanel } from './property-panel';
import { ToolPropertyPanel } from './tool-property-panel';
import { TrackList, type TrackListActions } from './track-list';
import { PanelSection } from './panel-section';
import { CanvasHudLayer, type CanvasHuds } from './canvas-huds';
import { Toast } from './toast';
import { SettingsDialog, type MidiSettings } from './settings-dialog';
import { addTrackWithPickedTone, newTone } from './track-actions';
import iconTempo from '../assets/icons/tempo.svg?raw';
import iconSnap from '../assets/icons/snap.svg?raw';
import iconPrism from '../assets/icons/prism.svg?raw';
import iconTuning from '../assets/icons/tuning.svg?raw';

/**
 * The app's layout (BACKLOG 15.3, 15.4): the top bar; the icon rail with its
 * drawers and the tool strip; the canvas, its zoom sliders and the Parameters
 * Graph; and the side panel. It replaces main.ts's HTML template.
 *
 * main.ts renders it twice. First without `parts`: the shell, so the canvases
 * exist before the engines that draw on them are made. Then
 * with them, once the commands and actions exist, which adds the panels.
 * The tree's shape is the same both times, so Preact keeps the canvases and
 * the hosts that main.ts holds; App itself reads no signals, so it never
 * re-renders on its own.
 */

/** The top bar's menus: lists of catalog commands. The registry says what
 *  each does, whether it can run now, and whether a setting is on. */
export const MENUS: readonly MenuSpec[] = [
  { label: 'File', entries: ['file.save', 'file.open', '-', 'file.importMidi', 'file.exportWav'] },
  {
    label: 'Edit',
    entries: [
      'edit.undo', 'edit.redo', '-',
      'edit.cut', 'edit.copy', 'edit.paste', 'edit.duplicate', 'edit.continue', 'edit.delete', '-',
      'edit.join', 'edit.group', 'edit.ungroup', '-',
      'edit.moveUp', 'edit.moveDown', 'edit.copyUp', 'edit.copyDown', '-',
      'edit.sendToGuides', 'edit.copyToGuides', '-',
      'edit.smooth', 'edit.sharpen', 'edit.simplify',
    ],
  },
  {
    label: 'View',
    entries: [
      'view.pitchHud', 'view.perfHud', 'view.scrollDuringPlayback', 'view.fullscreen', '-',
      'view.frets', '-',
      'view.start', 'view.end', 'view.playhead', '-',
      'help.open',
    ],
  },
];

/** What the panels need: made after the canvases, so they come in the
 *  second render. */
export interface AppParts {
  commands: CommandRegistry;
  canUndo: ReadonlySignal<boolean>;
  canRedo: ReadonlySignal<boolean>;
  /** Phrases the rolling buffer can keep. Engine state, polled per frame. */
  keepable: ReadonlySignal<number>;
  /** The left button is sounding, so the tool strip can't change tools. */
  toolsLocked: ReadonlySignal<boolean>;
  tempo: TempoActions;
  snap: SnapActions;
  tuning: TuningActions;
  tracks: TrackListActions;
  settingsOpen: Signal<boolean>;
  midi: MidiSettings;
}

export function App({ huds, parts }: {
  /** What sits over the canvas; the frame loop sets it. */
  huds: CanvasHuds;
  parts: AppParts | null;
}) {
  return (
    <>
      <div id="toolbar">
        {parts && <TopBar commands={parts.commands} menus={MENUS} canUndo={parts.canUndo} canRedo={parts.canRedo} keepable={parts.keepable} />}
      </div>
      <div id="main-area">
        <Drawers
          drawers={[
            { id: 'tempo', label: 'Tempo', icon: iconTempo, body: parts && <TempoPanel actions={parts.tempo} /> },
            { id: 'snap', label: 'Snap', icon: iconSnap, body: parts && <SnapPanel actions={parts.snap} /> },
            {
              id: 'prism', label: 'Harmonic Prism', icon: iconPrism, body: parts && <PrismPanel />,
              headerTitle: `Harmonic Prism — ${primaryShortcut('prism.drawMode')}: Draw mode`,
            },
            { id: 'tuning', label: 'Tuning', icon: iconTuning, body: parts && <TuningPanel actions={parts.tuning} /> },
          ]}
          tools={parts && <ToolStrip commands={parts.commands} locked={parts.toolsLocked} />}
        />
        <Stage huds={huds} />
        <div id="property-panel">
          <PanelSection title="Tool" id="tool-prop-content">
            {parts && <ToolPropertyPanel />}
          </PanelSection>
          <PanelSection title="Selection" id="prop-content">
            {parts && <PropertyPanel commands={parts.commands} />}
          </PanelSection>
          <PanelSection title="Tracks" id="tracks-section">
            <div id="track-list">
              {parts && <TrackList actions={parts.tracks} />}
            </div>
            <div class="track-panel-actions">
              <button id="add-track-btn" title="Add track" onClick={e => { void addTrackWithPickedTone(e.currentTarget); }}>+ Track</button>
              <button id="new-tone-btn" title="Create new tone" onClick={() => { void newTone(); }}>+ Tone</button>
            </div>
          </PanelSection>
        </div>
      </div>
      {parts && <SettingsDialog open={parts.settingsOpen} midi={parts.midi} />}
      <Toast />
    </>
  );
}

/**
 * The canvas and what sits on it (HUDs, the count-in, the idle warning), the
 * zoom sliders along its edges like scrollbars, never over it (13.32: pitch
 * down the right side, time along the bottom), and the Parameters Graph. The
 * canvases and sliders are driven imperatively: main.ts finds them by id.
 */
function Stage({ huds }: { huds: CanvasHuds }) {
  return (
    <div id="center-stack">
      <div id="canvas-row">
        <div id="canvas-container">
          <canvas id="bg-canvas"></canvas>
          <canvas id="fg-canvas"></canvas>
          <CanvasHudLayer huds={huds} />
        </div>
        <div id="zoom-y-gutter" class="zoom-gutter">
          {/* No value here: the zoom sliders own it (ui/zoom-sliders.ts), and a
              value prop would be put back on the second render. */}
          <input type="range" id="zoom-y" min={MIN_ZOOM_Y} max={MAX_ZOOM_Y} step="0.001" title="Zoom pitch" aria-label="Zoom pitch" />
        </div>
      </div>
      <div id="zoom-x-gutter" class="zoom-gutter">
        <input type="range" id="zoom-x" min="0" max="1000" step="1" title="Zoom time" aria-label="Zoom time" />
      </div>
      <div id="param-container">
        <div id="param-resize-handle" title="Drag to resize the Parameters Graph"></div>
        <div id="param-graph-label">Volume</div>
        <canvas id="param-canvas"></canvas>
      </div>
    </div>
  );
}

export interface DrawerSpec {
  id: string;
  label: string;
  /** The rail icon (an SVG from src/assets/icons). */
  icon: string;
  body: ComponentChildren;
  /** The drawer header's tooltip, when it has one. */
  headerTitle?: string;
}

/**
 * The icon rail and its drawers (WS3). Each icon toggles its drawer, which
 * slides out over the canvas edge; one is open at a time. The drawers are
 * positioned absolutely (CSS), so the canvas never reflows when one opens.
 * Escape, or a press anywhere outside the rail and the drawers, closes it.
 * The tool strip sits on the rail below the icons.
 */
export function Drawers({ drawers, tools }: { drawers: readonly DrawerSpec[]; tools: ComponentChildren }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Don't steal Escape from text inputs (name field, etc.).
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      setOpenId(null);
    };
    // mousedown comes before the rail icon's click, so presses on the rail or
    // in a drawer are left alone and the icon still toggles.
    const onPress = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (t && (railRef.current?.contains(t) || hostRef.current?.contains(t))) return;
      setOpenId(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPress);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPress);
    };
  }, [openId]);

  return (
    <>
      <div id="rail" ref={railRef}>
        {drawers.map(d => (
          <button
            key={d.id}
            class={`rail-icon${openId === d.id ? ' active' : ''}`}
            data-drawer={d.id}
            title={d.label}
            aria-label={d.label}
            onClick={() => setOpenId(openId === d.id ? null : d.id)}
          >
            <Icon svg={d.icon} />
          </button>
        ))}
        <div class="rail-divider" role="separator"></div>
        <div id="tool-strip-host">{tools}</div>
      </div>
      <div id="drawer-host" ref={hostRef} class={openId !== null ? 'has-open' : undefined}>
        {drawers.map(d => (
          <div key={d.id} class={`drawer${openId === d.id ? ' open' : ''}`} id={`drawer-${d.id}`} data-drawer={d.id}>
            <div class="drawer-header" title={d.headerTitle}>{d.label}</div>
            <div id={`${d.id}-panel`}>{d.body}</div>
          </div>
        ))}
      </div>
    </>
  );
}
