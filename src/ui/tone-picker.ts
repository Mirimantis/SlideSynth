import type { ToneDefinition } from '../types';

/**
 * Show a popup near a target element listing all available tones.
 * Returns a promise that resolves with the chosen tone, or null if cancelled.
 */
export function openTonePicker(
  tones: ToneDefinition[],
  currentToneId: string | null,
  anchorEl: HTMLElement,
): Promise<ToneDefinition | null> {
  return new Promise((resolve) => {
    // Remove any existing picker
    document.querySelector('.tone-picker-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'tone-picker-overlay';

    const popup = document.createElement('div');
    popup.className = 'tone-picker-popup';

    // Position near anchor
    const rect = anchorEl.getBoundingClientRect();
    popup.style.top = `${rect.bottom + 4}px`;
    popup.style.left = `${rect.left}px`;

    // Ensure popup doesn't go off-screen right
    requestAnimationFrame(() => {
      const popupRect = popup.getBoundingClientRect();
      if (popupRect.right > window.innerWidth - 8) {
        popup.style.left = `${window.innerWidth - popupRect.width - 8}px`;
      }
      // If it goes below viewport, flip above
      if (popupRect.bottom > window.innerHeight - 8) {
        popup.style.top = `${rect.top - popupRect.height - 4}px`;
      }
    });

    const header = document.createElement('div');
    header.className = 'tone-picker-header';
    header.textContent = 'Select Tone';
    popup.appendChild(header);

    for (const tone of tones) {
      const item = document.createElement('div');
      item.className = `tone-picker-item${tone.id === currentToneId ? ' current' : ''}`;

      // Color swatch with dash preview
      const swatch = document.createElement('div');
      swatch.className = 'tone-picker-swatch';
      swatch.style.background = tone.color;
      item.appendChild(swatch);

      // Dash preview canvas
      const dashCanvas = document.createElement('canvas');
      dashCanvas.width = 30;
      dashCanvas.height = 10;
      dashCanvas.className = 'tone-picker-dash';
      item.appendChild(dashCanvas);

      // Draw dash
      requestAnimationFrame(() => {
        const ctx = dashCanvas.getContext('2d')!;
        ctx.strokeStyle = tone.color;
        ctx.lineWidth = 2;
        ctx.setLineDash(tone.dashPattern);
        ctx.beginPath();
        ctx.moveTo(0, 5);
        ctx.lineTo(30, 5);
        ctx.stroke();
      });

      const name = document.createElement('span');
      name.className = 'tone-picker-name';
      name.textContent = tone.name;
      item.appendChild(name);

      // Layer summary
      const info = document.createElement('span');
      info.className = 'tone-picker-info';
      info.textContent = tone.layers.map(l => l.type[0]!.toUpperCase()).join('+');
      item.appendChild(info);

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        cleanup();
        resolve(tone);
      });

      popup.appendChild(item);
    }

    function cleanup() {
      overlay.remove();
    }

    // Click overlay to cancel
    overlay.addEventListener('click', () => {
      cleanup();
      resolve(null);
    });

    // Escape to cancel
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        cleanup();
        window.removeEventListener('keydown', onKey);
        resolve(null);
      }
    }
    window.addEventListener('keydown', onKey);

    overlay.appendChild(popup);
    document.body.appendChild(overlay);
  });
}
