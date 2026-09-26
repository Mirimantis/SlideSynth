import '@preact/signals'; // components re-render when the store fields they read change
import type { ReadonlySignal } from '@preact/signals';
import type { ToolMode } from '../types';
import { store } from '../state/store';
import { commandTitle, type CommandId } from '../commands/catalog';
import type { CommandRegistry } from '../commands/registry';
import { forcesScrollView } from '../state/transport';
import { QUALITY_LABELS, STACKING_LABELS } from '../utils/harmonics';
import { Icon } from './icon';
import { CommandButton } from './command-button';
import iconDraw from '../assets/icons/draw.svg?raw';
import iconSelect from '../assets/icons/select.svg?raw';
import iconDelete from '../assets/icons/delete.svg?raw';
import iconSlice from '../assets/icons/slice.svg?raw';
import iconPerform from '../assets/icons/perform.svg?raw';

/** The command behind each tool button (BACKLOG 15.3). */
export const TOOL_COMMANDS: Readonly<Record<ToolMode, CommandId>> = {
  draw: 'tool.draw',
  select: 'tool.select',
  delete: 'tool.delete',
  scissors: 'tool.slice',
};

const TOOL_ICONS: Readonly<Record<ToolMode, string>> = {
  draw: iconDraw,
  select: iconSelect,
  delete: iconDelete,
  scissors: iconSlice,
};

const TOOLS: readonly ToolMode[] = ['draw', 'select', 'delete', 'scissors'];

/**
 * The tool strip (BACKLOG 16.4): Draw, Select, Delete, Slice and the Perform
 * entry, always visible in the left rail below the drawer icons. The lit
 * button follows the store, not the click: a click can be refused (leaving
 * Perform mid-recording). In Perform no tool is lit, Perform is.
 *
 * While Prism Draw is on, Draw and Perform carry a chord badge (the voice
 * count), so the mode shows without opening the drawer.
 */
export function ToolStrip({ commands, locked }: {
  commands: CommandRegistry;
  /** The left button is sounding; tools can't change until it lets go. */
  locked: ReadonlySignal<boolean>;
}) {
  const st = store.getState();
  const lit = st.performMode ? null : st.activeTool;
  const badge = st.harmonicPrism.drawMode ? <ChordBadge /> : null;
  return (
    <div class="tool-strip" role="toolbar" aria-label="Tools" aria-orientation="vertical">
      {TOOLS.map(tool => (
        <CommandButton
          key={tool}
          id={TOOL_COMMANDS[tool]}
          commands={commands}
          class={`strip-btn${tool === lit ? ' active' : ''}`}
          pressed={tool === lit}
          disabled={locked.value}
        >
          <Icon svg={TOOL_ICONS[tool]} />
          {tool === 'draw' && badge}
        </CommandButton>
      ))}
      <CommandButton
        id="perform.toggle"
        commands={commands}
        class={`strip-btn perform-entry${st.performMode ? ' active' : ''}`}
        pressed={st.performMode}
        // A recording keeps you in Perform until it stops.
        disabled={locked.value || (st.performMode && forcesScrollView(st.transport))}
      >
        <Icon svg={iconPerform} />
        {badge}
      </CommandButton>
    </div>
  );
}

function ChordBadge() {
  const spec = store.getState().harmonicPrism.chordSpec;
  const chord = `${QUALITY_LABELS[spec.quality]} ${STACKING_LABELS[spec.stacking]}, ${spec.numVoices} voices`;
  return (
    <span class="chord-badge" title={`Prism Draw: ${chord}\n${commandTitle('prism.drawMode')}`}>
      {spec.numVoices}
    </span>
  );
}
