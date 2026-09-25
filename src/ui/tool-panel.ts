import type { ToolMode } from '../types';
import { commandTitle, type CommandId } from '../commands/catalog';

/** The command behind each tool button (BACKLOG 15.3). */
export const TOOL_COMMANDS: Readonly<Record<ToolMode, CommandId>> = {
  draw: 'tool.draw',
  select: 'tool.select',
  delete: 'tool.delete',
  scissors: 'tool.slice',
};

export interface ToolPanelCallbacks {
  onToolChange(tool: ToolMode): void;
}

export function createToolPanel(
  container: HTMLElement,
  callbacks: ToolPanelCallbacks,
): {
  /** Light the active tool's button; null lights none (in Perform). */
  updateTool(tool: ToolMode | null): void;
  setDisabled(disabled: boolean): void;
} {
  container.innerHTML = `
    <div class="tool-panel-grid">
      <button id="tool-draw" class="tool-btn active" data-tool="draw" title="${commandTitle(TOOL_COMMANDS.draw)}">Draw</button>
      <button id="tool-select" class="tool-btn" data-tool="select" title="${commandTitle(TOOL_COMMANDS.select)}">Select</button>
      <button id="tool-delete" class="tool-btn" data-tool="delete" title="${commandTitle(TOOL_COMMANDS.delete)}">Delete</button>
      <button id="tool-scissors" class="tool-btn" data-tool="scissors" title="${commandTitle(TOOL_COMMANDS.scissors)}">Slice</button>
    </div>
  `;

  const toolBtns = container.querySelectorAll('.tool-btn[data-tool]');
  toolBtns.forEach(btn => {
    // The lit button follows the store (updateTool), not the click: a click
    // can be refused, e.g. leaving Perform mid-recording.
    btn.addEventListener('click', () => {
      callbacks.onToolChange(btn.getAttribute('data-tool') as ToolMode);
    });
  });

  return {
    updateTool(tool: ToolMode | null) {
      toolBtns.forEach(b => b.classList.toggle('active', b.getAttribute('data-tool') === tool));
    },
    setDisabled(disabled: boolean) {
      toolBtns.forEach(b => {
        (b as HTMLButtonElement).disabled = disabled;
      });
    },
  };
}
