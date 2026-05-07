import { SCALE_CATALOG, getScaleGroups } from '../utils/scales';

export interface ToolbarCallbacks {
  /** 8.19: Key dropdown is tri-state. Chromatic = (null, false), None = (null, true),
   *  scale tone = (0..11, false). hidePitchLines is only meaningful when root===null. */
  onScaleRootChange(root: number | null, hidePitchLines: boolean): void;
  onScaleIdChange(scaleId: string | null): void;
}

export function createToolbar(
  container: HTMLElement,
  callbacks: ToolbarCallbacks,
): {
  updateScaleRoot(root: number | null, hidePitchLines: boolean): void;
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
      <div class="toolbar-group scale">
        <label>Key</label>
        <select id="scale-root">
          <option value="chromatic">Chromatic</option>
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

  // Scale root / type
  const scaleRootSelect = container.querySelector('#scale-root') as HTMLSelectElement;
  const scaleTypeSelect = container.querySelector('#scale-type') as HTMLSelectElement;

  scaleRootSelect.addEventListener('change', () => {
    const val = scaleRootSelect.value;
    if (val === 'chromatic') {
      scaleTypeSelect.disabled = true;
      callbacks.onScaleRootChange(null, false);
    } else if (val === 'none') {
      scaleTypeSelect.disabled = true;
      callbacks.onScaleRootChange(null, true);
    } else {
      scaleTypeSelect.disabled = false;
      callbacks.onScaleRootChange(Number(val), false);
      callbacks.onScaleIdChange(scaleTypeSelect.value);
    }
    scaleRootSelect.blur();
  });

  scaleTypeSelect.addEventListener('change', () => {
    callbacks.onScaleIdChange(scaleTypeSelect.value);
    scaleTypeSelect.blur();
  });

  return {
    updateScaleRoot(root: number | null, hidePitchLines: boolean) {
      scaleRootSelect.value = root === null
        ? (hidePitchLines ? 'none' : 'chromatic')
        : String(root);
      scaleTypeSelect.disabled = root === null;
    },
    updateScaleId(scaleId: string | null) {
      if (scaleId) scaleTypeSelect.value = scaleId;
    },
  };
}
