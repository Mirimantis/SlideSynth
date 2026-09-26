import { formatChord, parseChord } from './keys';

/**
 * The command catalog (BACKLOG 15.3): one table of every named action, with
 * its label, key bindings and description. The keyboard, the toolbar and
 * tool buttons, the file and context menus, tooltips, and the help page's
 * shortcut table all read from it, so a binding or a name changes in one
 * place. What each command *does* is bound at runtime (registry.ts).
 *
 * Pure data, without DOM or store imports, so help.html can load it.
 */

export type CommandSection = 'Transport' | 'Perform' | 'Tools' | 'Edit' | 'Harmonic Prism' | 'View' | 'File';

export interface CommandSpec {
  readonly id: string;
  /** Short name: button text, menu label, first words of a tooltip. */
  readonly label: string;
  readonly section: CommandSection;
  /** Key chords, first one shown in tooltips and menus. See keys.ts. */
  readonly keys?: readonly string[];
  /** Continues the label in tooltips and on the help page ("Label — description"). */
  readonly description?: string;
  /** A held key: its release goes to the command too (A audition, F swell). */
  readonly hold?: boolean;
  /** Ignore keyboard auto-repeat (toggles and one-shot perform actions). */
  readonly once?: boolean;
}

export const COMMANDS = [
  // ── Transport ──
  { id: 'transport.playPause', label: 'Play / Pause', section: 'Transport', keys: ['Space'], once: true },
  { id: 'transport.play', label: 'Play', section: 'Transport' },
  { id: 'transport.pause', label: 'Pause', section: 'Transport' },
  { id: 'transport.stop', label: 'Stop', section: 'Transport', description: 'rewinds the playhead' },
  { id: 'transport.record', label: 'Record', section: 'Transport', keys: ['R'], once: true,
    description: 'arm or disarm recording onto the selected track' },
  { id: 'transport.recordPass', label: 'Record one pass', section: 'Transport', keys: ['Shift+R'], once: true,
    description: 'record exactly one full loop pass (or Shift+click Record)' },
  { id: 'transport.layerMode', label: 'New track per pass', section: 'Transport',
    description: 'each loop pass you perform lands on its own track' },
  { id: 'transport.countIn', label: 'Count-in', section: 'Transport',
    description: 'count in before recording from a stop' },
  { id: 'transport.loop', label: 'Loop', section: 'Transport', keys: ['L'], description: 'toggle looping between the loop markers' },
  { id: 'transport.escape', label: 'Cancel', section: 'Transport', keys: ['Escape'],
    description: 'stop a count-in or recording; otherwise leave Perform, or finish drawing, close the transform box and clear Prism projection' },

  // ── Perform ──
  { id: 'perform.toggle', label: 'Perform', section: 'Perform', keys: ['P'], once: true,
    description: 'enter or leave Perform: the left button plays the rail, and Play runs until you stop it' },
  { id: 'perform.keep', label: 'Keep that', section: 'Perform', keys: ['K'], once: true,
    description: 'commit the phrase you just played' },
  { id: 'perform.dropPass', label: 'Drop last pass', section: 'Perform', keys: ['U'], once: true,
    description: 'remove the last performed pass (undo the last layer)' },
  { id: 'perform.swell', label: 'Swell', section: 'Perform', keys: ['F'], hold: true,
    description: 'hold to swell the note you’re performing (Dynamics: Key swell)' },

  // ── Tools ──
  { id: 'tool.draw', label: 'Draw', section: 'Tools', keys: ['D'] },
  { id: 'tool.select', label: 'Select', section: 'Tools', keys: ['V'] },
  { id: 'tool.delete', label: 'Delete', section: 'Tools', keys: ['X'], description: 'click a point to remove it' },
  { id: 'tool.slice', label: 'Slice', section: 'Tools', keys: ['C'], description: 'click a curve to split it' },
  { id: 'edit.finishCurve', label: 'Finish curve', section: 'Tools', keys: ['Enter'], description: 'end the curve you’re drawing' },
  { id: 'snap.toggle', label: 'Snap', section: 'Tools', keys: ['S'], description: 'toggle snap' },
  { id: 'preview.audition', label: 'Audition', section: 'Tools', keys: ['A'], hold: true,
    description: 'hold to hear the pitch under the Draw cursor, or a Y guide’s pitch while you drag it' },

  // ── Edit ──
  { id: 'edit.undo', label: 'Undo', section: 'Edit', keys: ['Ctrl+Z'] },
  { id: 'edit.redo', label: 'Redo', section: 'Edit', keys: ['Ctrl+Shift+Z', 'Ctrl+Y'] },
  { id: 'edit.copy', label: 'Copy', section: 'Edit', keys: ['Ctrl+C'] },
  { id: 'edit.cut', label: 'Cut', section: 'Edit', keys: ['Ctrl+X'] },
  { id: 'edit.paste', label: 'Paste', section: 'Edit', keys: ['Ctrl+V'], description: 'at the playhead (under the rail when the rail is showing)' },
  { id: 'edit.duplicate', label: 'Duplicate', section: 'Edit', keys: ['Ctrl+D'] },
  { id: 'edit.continue', label: 'Continue curves', section: 'Edit', keys: ['Ctrl+Shift+D'],
    description: 'copy the selection so each copy starts where its original ends' },
  { id: 'edit.delete', label: 'Delete selection', section: 'Edit', keys: ['Delete', 'Backspace'],
    description: 'the selected guide, points or curves' },
  { id: 'edit.join', label: 'Join', section: 'Edit', keys: ['Ctrl+J'], description: 'merge the selected curves into one' },
  { id: 'edit.group', label: 'Group', section: 'Edit', keys: ['Ctrl+G'] },
  { id: 'edit.ungroup', label: 'Ungroup', section: 'Edit', keys: ['Ctrl+Shift+G'] },
  { id: 'edit.smooth', label: 'Smooth Curve', section: 'Edit', keys: ['Shift+S'], description: 'reset handles to the auto-smooth defaults' },
  { id: 'edit.sharpen', label: 'Sharpen Curve', section: 'Edit', keys: ['Alt+S'], description: 'clear all handles for sharp corners' },

  // ── Harmonic Prism ──
  { id: 'prism.drawMode', label: 'Prism Draw mode', section: 'Harmonic Prism', keys: ['H'],
    description: 'each Draw click places a chord cluster' },
  { id: 'prism.projection', label: 'Prism Projection', section: 'Harmonic Prism', keys: ['Ctrl+H'],
    description: 'project harmonic echoes from the selected curve' },

  // ── View ──
  { id: 'view.start', label: 'Go to start', section: 'View', keys: ['PageUp'],
    description: 'scroll to the first control point (beat 0 on an empty canvas)' },
  { id: 'view.end', label: 'Go to end', section: 'View', keys: ['PageDown'], description: 'scroll to the last control point' },
  { id: 'view.playhead', label: 'Go to playhead', section: 'View', keys: ['Home'] },
  { id: 'view.pitchHud', label: 'Pitch HUD', section: 'View', description: 'the pitch under the cursor, in notes, cents and Hz' },
  { id: 'view.scrollDuringPlayback', label: 'Scroll canvas during playback', section: 'View',
    description: 'in Compose, slide the canvas past a fixed rail instead of moving the playhead' },
  { id: 'view.perfHud', label: 'Perf HUD', section: 'View', keys: ['!'], description: 'frame times, voice counts and audio latency' },
  { id: 'help.open', label: 'User Manual', section: 'View', keys: ['?'] },
  { id: 'app.settings', label: 'Settings', section: 'View', description: 'MIDI input and other preferences' },

  // ── File ──
  { id: 'file.save', label: 'Save Composition', section: 'File' },
  { id: 'file.open', label: 'Load Composition', section: 'File' },
  { id: 'file.importMidi', label: 'Import MIDI', section: 'File' },
  { id: 'file.exportWav', label: 'Export WAV', section: 'File' },
] as const satisfies readonly CommandSpec[];

export type CommandId = (typeof COMMANDS)[number]['id'];

/** COMMANDS widened to CommandSpec, for iterating optional fields. */
export const COMMAND_SPECS: readonly (CommandSpec & { id: CommandId })[] = COMMANDS;

const BY_ID: ReadonlyMap<string, CommandSpec> = new Map(COMMAND_SPECS.map(c => [c.id, c]));

export function commandSpec(id: CommandId): CommandSpec {
  return BY_ID.get(id)!;
}

/** Display text of a command's key chords ("Ctrl+Shift+Z / Ctrl+Y"), or "". */
export function shortcutText(id: CommandId, sep = ' / '): string {
  return (commandSpec(id).keys ?? []).map(k => formatChord(parseChord(k))).join(sep);
}

/** Display text of a command's first key chord ("Shift+S"), or "". */
export function primaryShortcut(id: CommandId): string {
  const keys = commandSpec(id).keys?.[0];
  return keys ? formatChord(parseChord(keys)) : '';
}

/** Tooltip: "Record (R) — arm or disarm recording onto the selected track". */
export function commandTitle(id: CommandId): string {
  const spec = commandSpec(id);
  const keys = primaryShortcut(id);
  const head = keys ? `${spec.label} (${keys})` : spec.label;
  return spec.description ? `${head} — ${spec.description}` : head;
}

/** Mouse and modifier gestures — not commands, but part of the help page's
 *  shortcut table. */
export const GESTURES: readonly { keys: string; action: string }[] = [
  { keys: 'Ctrl (hold in Draw)', action: 'Temporary Select' },
  { keys: 'Shift+click', action: 'Add or remove a point or curve from the selection' },
  { keys: 'Shift (hold while dragging)', action: 'Constrain to one axis' },
  { keys: 'Alt+drag on a transform box', action: 'Duplicate, then transform the copy' },
  { keys: 'Alt+drag / middle-drag', action: 'Pan the canvas' },
  { keys: 'Scroll wheel', action: 'Zoom Y' },
  { keys: 'Ctrl+scroll', action: 'Zoom X' },
];
