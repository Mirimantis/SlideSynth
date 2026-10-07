import { useEffect, useRef, useState } from 'preact/hooks';
import { showDialog } from './dialog-host';

/**
 * Small modal that prompts the user for a preset name. Returns the trimmed
 * name on Save, or null on Cancel / Escape. Empty and taken names are
 * refused with a warning. A Preact component since BACKLOG 15.4.
 */
export function openPresetSaveDialog(opts: {
  title: string;
  initialName?: string;
  existingNames: readonly string[];
}): Promise<string | null> {
  return showDialog<string | null>(done => <PresetSaveDialog {...opts} onDone={done} />);
}

export function PresetSaveDialog({ title, initialName, existingNames, onDone }: {
  title: string;
  initialName?: string;
  existingNames: readonly string[];
  onDone(name: string | null): void;
}) {
  const [name, setName] = useState(initialName ?? '');
  const [warning, setWarning] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  function trySave() {
    const trimmed = name.trim();
    const problem = !trimmed ? 'Name can\'t be empty.'
      : existingNames.includes(trimmed) ? `A preset named "${trimmed}" already exists.`
      : null;
    if (problem) {
      setWarning(problem);
      input.current?.focus();
      return;
    }
    onDone(trimmed);
  }

  return (
    <div class="modal-overlay">
      <div class="modal preset-save-modal" style={{ maxWidth: '360px' }}>
        <h2>{title}</h2>
        <div class="tb-row">
          <label for="ps-name">Name</label>
          <input
            type="text" id="ps-name" ref={input} value={name} placeholder="My preset"
            // Hide the warning as the user types past it.
            onInput={e => { setName(e.currentTarget.value); setWarning(null); }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                trySave();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onDone(null);
              }
            }}
          />
        </div>
        <div class="ps-warning" id="ps-warning" hidden={warning === null}>{warning}</div>
        <div class="tb-actions" style={{ justifyContent: 'flex-end' }}>
          <button id="ps-cancel" class="tb-btn" onClick={() => onDone(null)}>Cancel</button>
          <button id="ps-save" class="tb-btn primary" onClick={trySave}>Save</button>
        </div>
      </div>
    </div>
  );
}
