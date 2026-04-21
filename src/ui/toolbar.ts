import { SCALE_CATALOG, getScaleGroups } from '../utils/scales';

export interface ToolbarCallbacks {
  onSnapToggle(enabled: boolean): void;
  onScaleRootChange(root: number | null): void;
  onScaleIdChange(scaleId: string | null): void;
}

export function createToolbar(
  container: HTMLElement,
  callbacks: ToolbarCallbacks,
): {
  updateSnap(enabled: boolean): void;
  updateScaleRoot(root: number | null): void;
  updateScaleId(scaleId: string | null): void;
} {
  // Build scale type <optgroup> options
  const groups = getScaleGroups();
  let scaleOptionsHtml = '';
  for (const group of groups) {
    scaleOptionsHtml += `<optgroup label="${group}">`;
    for (const s of SCALE_CATALOG.filter(sc => sc.group === group)) {
      scaleOptionsHtml += `<option value="${s.id}">${s.name}</option>`;
    }
    scaleOptionsHtml += '</optgroup>';
  }

  container.innerHTML = `
    <div class="toolbar-row">
      <div class="toolbar-group">
        <button id="snap-toggle" class="tool-btn active" title="Toggle snap (S)">Snap</button>
      </div>

      <div class="toolbar-group scale">
        <label>Key</label>
        <select id="scale-root">
          <option value="none">None</option>
          <option value="0">C</option>
          <option value="1">C#</option>
          <option value="2">D</option>
          <option value="3">D#</option>
          <option value="4">E</option>
          <option value="5">F</option>
          <option value="6">F#</option>
          <option value="7">G</option>
          <option value="8">G#</option>
          <option value="9">A</option>
          <option value="10">A#</option>
          <option value="11">B</option>
        </select>
        <select id="scale-type" disabled>
          ${scaleOptionsHtml}
        </select>
      </div>
    </div>
  `;

  // Snap toggle
  const snapToggle = container.querySelector('#snap-toggle') as HTMLButtonElement;
  let snapOn = true;
  snapToggle.addEventListener('click', () => {
    snapOn = !snapOn;
    snapToggle.classList.toggle('active', snapOn);
    callbacks.onSnapToggle(snapOn);
  });

  // Scale root / type
  const scaleRootSelect = container.querySelector('#scale-root') as HTMLSelectElement;
  const scaleTypeSelect = container.querySelector('#scale-type') as HTMLSelectElement;

  scaleRootSelect.addEventListener('change', () => {
    const val = scaleRootSelect.value;
    if (val === 'none') {
      scaleTypeSelect.disabled = true;
      callbacks.onScaleRootChange(null);
    } else {
      scaleTypeSelect.disabled = false;
      callbacks.onScaleRootChange(Number(val));
      callbacks.onScaleIdChange(scaleTypeSelect.value);
    }
    scaleRootSelect.blur();
  });

  scaleTypeSelect.addEventListener('change', () => {
    callbacks.onScaleIdChange(scaleTypeSelect.value);
    scaleTypeSelect.blur();
  });

  return {
    updateSnap(enabled: boolean) {
      snapOn = enabled;
      snapToggle.classList.toggle('active', enabled);
    },
    updateScaleRoot(root: number | null) {
      scaleRootSelect.value = root === null ? 'none' : String(root);
      scaleTypeSelect.disabled = root === null;
    },
    updateScaleId(scaleId: string | null) {
      if (scaleId) scaleTypeSelect.value = scaleId;
    },
  };
}
