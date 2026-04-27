// Lightweight transient toast — slides in from the bottom-center, fades out
// after a short delay. Used for refused actions where the user benefits from
// a brief explanation (e.g. "can't join curves from different groups").

let activeToast: HTMLDivElement | null = null;
let activeTimer: number | null = null;

const STYLE_ID = 'slidesynth-toast-style';

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .slidesynth-toast {
      position: fixed;
      left: 50%;
      bottom: 48px;
      transform: translateX(-50%);
      background: rgba(30, 30, 36, 0.95);
      color: #f0f0f0;
      padding: 8px 16px;
      border-radius: 6px;
      font: 13px/1.4 system-ui, sans-serif;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
      z-index: 9999;
      pointer-events: none;
      opacity: 0;
      transition: opacity 180ms ease;
    }
    .slidesynth-toast.visible { opacity: 1; }
  `;
  document.head.appendChild(style);
}

export function showToast(message: string, durationMs = 2200): void {
  ensureStyle();
  if (activeToast) {
    activeToast.remove();
    activeToast = null;
  }
  if (activeTimer !== null) {
    window.clearTimeout(activeTimer);
    activeTimer = null;
  }
  const el = document.createElement('div');
  el.className = 'slidesynth-toast';
  el.textContent = message;
  document.body.appendChild(el);
  // Force reflow so the transition triggers when we add 'visible'.
  void el.offsetHeight;
  el.classList.add('visible');
  activeToast = el;
  activeTimer = window.setTimeout(() => {
    el.classList.remove('visible');
    window.setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
      if (activeToast === el) activeToast = null;
    }, 200);
    activeTimer = null;
  }, durationMs);
}
