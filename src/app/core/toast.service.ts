import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  title: string;
  detail?: string;
}

/** Short confirmations after an action ("Saved. 15 details removed."). */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private nextId = 0;

  /** Shown for 12 s: long enough to read twice at a slow pace. It can also be closed. */
  show(title: string, detail?: string, ms = 12_000) {
    const id = this.nextId++;
    this.toasts.update((t) => [...t, { id, title, detail }]);
    setTimeout(() => this.dismiss(id), ms);
  }

  dismiss(id: number) {
    this.toasts.update((t) => t.filter((x) => x.id !== id));
  }
}
