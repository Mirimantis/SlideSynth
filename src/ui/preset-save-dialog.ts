/**
 * Small modal that prompts the user for a preset name. Returns the trimmed
 * name on Save, or null on Cancel / empty input. Mirrors the tone-builder
 * pattern (overlay + .modal + cleanup on resolve) but kept minimal — just one
 * row + two buttons.
 */
export function openPresetSaveDialog(opts: {
  title: string;
  initialName?: string;
  existingNames: readonly string[];
}): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'modal preset-save-modal';
    modal.style.maxWidth = '360px';

    modal.innerHTML = `
      <h2>${escapeHtml(opts.title)}</h2>
      <div class="tb-row">
        <label for="ps-name">Name</label>
        <input type="text" id="ps-name" value="${escapeAttr(opts.initialName ?? '')}" placeholder="My Snap Preset" />
      </div>
      <div class="ps-warning" id="ps-warning" hidden></div>
      <div class="tb-actions" style="justify-content: flex-end;">
        <button id="ps-cancel" class="tb-btn">Cancel</button>
        <button id="ps-save" class="tb-btn primary">Save</button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const input = modal.querySelector('#ps-name') as HTMLInputElement;
    const warning = modal.querySelector('#ps-warning') as HTMLDivElement;
    const saveBtn = modal.querySelector('#ps-save') as HTMLButtonElement;
    const cancelBtn = modal.querySelector('#ps-cancel') as HTMLButtonElement;

    function cleanup() {
      overlay.remove();
    }

    function trySave() {
      const name = input.value.trim();
      if (!name) {
        showWarning('Name can\'t be empty.');
        input.focus();
        return;
      }
      if (opts.existingNames.includes(name)) {
        showWarning(`A preset named "${name}" already exists.`);
        input.focus();
        return;
      }
      cleanup();
      resolve(name);
    }

    function showWarning(msg: string) {
      warning.textContent = msg;
      warning.hidden = false;
    }

    saveBtn.addEventListener('click', trySave);
    cancelBtn.addEventListener('click', () => {
      cleanup();
      resolve(null);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        trySave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cleanup();
        resolve(null);
      }
    });

    // Hide warning as user types past an error.
    input.addEventListener('input', () => {
      if (!warning.hidden) warning.hidden = true;
    });

    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]!));
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}
