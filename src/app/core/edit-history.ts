import { signal } from '@angular/core';
import { WorkingPage } from './models';

const MAX_UNDO = 100;

interface Stacks {
  undo: WorkingPage[][];
  redo: WorkingPage[][];
}

/**
 * Undo and redo for hand edits, per document. Each step is the document's pages before an
 * edit; pages are immutable, so keeping references is cheap.
 */
export class EditHistory {
  private readonly stacks = signal<Record<string, Stacks>>({});
  /** The document edited most recently, so keyboard shortcuts know where to apply. */
  readonly lastEdited = signal<string | null>(null);

  canUndo(id: string): boolean {
    return !!this.stacks()[id]?.undo.length;
  }

  canRedo(id: string): boolean {
    return !!this.stacks()[id]?.redo.length;
  }

  /** An edit happened: `before` becomes the undo step and redo is cleared. */
  record(id: string, before: WorkingPage[]) {
    this.stacks.update((all) => ({
      ...all,
      [id]: { undo: [...(all[id]?.undo ?? []), before].slice(-MAX_UNDO), redo: [] },
    }));
    this.lastEdited.set(id);
  }

  /** The pages to restore for an undo or redo, after saving `current` on the other stack. */
  step(id: string, direction: 'undo' | 'redo', current: WorkingPage[]): WorkingPage[] | null {
    const stacks = this.stacks()[id];
    const from = direction === 'undo' ? stacks?.undo : stacks?.redo;
    const pages = from?.at(-1);
    if (!stacks || !from || !pages) return null;
    const rest = from.slice(0, -1);
    this.stacks.update((all) => ({
      ...all,
      [id]:
        direction === 'undo'
          ? { undo: rest, redo: [...stacks.redo, current] }
          : { undo: [...stacks.undo, current], redo: rest },
    }));
    this.lastEdited.set(id);
    return pages;
  }

  clear(id: string) {
    this.stacks.update(({ [id]: _cleared, ...rest }) => rest);
    if (this.lastEdited() === id) this.lastEdited.set(null);
  }
}
