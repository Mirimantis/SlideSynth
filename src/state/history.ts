import type { Composition } from '../types';
import { store } from './store';

const MAX_UNDO = 50;

function cloneComposition(comp: Composition): Composition {
  return JSON.parse(JSON.stringify(comp));
}

type Listener = () => void;

class UndoHistory {
  private undoStack: Composition[] = [];
  private redoStack: Composition[] = [];
  private listeners: Set<Listener> = new Set();

  /** Capture current composition state before a mutation. */
  snapshot(): void {
    this.undoStack.push(cloneComposition(store.getComposition()));
    if (this.undoStack.length > MAX_UNDO) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
    this.notify();
  }

  undo(): void {
    if (this.undoStack.length === 0) return;
    this.redoStack.push(cloneComposition(store.getComposition()));
    const previous = this.undoStack.pop()!;
    store.loadComposition(previous);
    this.notify();
  }

  redo(): void {
    if (this.redoStack.length === 0) return;
    this.undoStack.push(cloneComposition(store.getComposition()));
    const next = this.redoStack.pop()!;
    store.loadComposition(next);
    this.notify();
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.notify();
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}

export const history = new UndoHistory();
