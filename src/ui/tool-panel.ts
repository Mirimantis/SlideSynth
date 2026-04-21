import type { ToolMode } from '../types';

export interface ToolPanelCallbacks {
  onToolChange(tool: ToolMode): void;
}

export function createToolPanel(
  container: HTMLElement,
  callbacks: ToolPanelCallbacks,
): {
  updateTool(tool: ToolMode): void;
  setDisabled(disabled: boolean): void;
} {
  container.innerHTML = `
    <div class="tool-panel-grid">
      <button id="tool-draw" class="tool-btn active" data-tool="draw" title="Draw (D)">Draw</button>
      <button id="tool-select" class="tool-btn" data-tool="select" title="Select (V)">Select</button>
      <button id="tool-delete" class="tool-btn" data-tool="delete" title="Delete (X)">Delete</button>
      <button id="tool-scissors" class="tool-btn" data-tool="scissors" title="Slice (C)">Slice</button>
    </div>
  `;

  const toolBtns = container.querySelectorAll('.tool-btn[data-tool]');
  toolBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      toolBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      callbacks.onToolChange(btn.getAttribute('data-tool') as ToolMode);
    });
  });

  return {
    updateTool(tool: ToolMode) {
      toolBtns.forEach(b => b.classList.toggle('active', b.getAttribute('data-tool') === tool));
    },
    setDisabled(disabled: boolean) {
      toolBtns.forEach(b => {
        (b as HTMLButtonElement).disabled = disabled;
      });
    },
  };
}
