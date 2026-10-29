import { Component, inject, input, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { describeHttpError, DocumentQueueService } from '../core/document-queue.service';

/** Downloads a saved (already redacted) document so more can be hidden, then opens the review. */
@Component({
  selector: 'app-open-saved',
  imports: [RouterLink],
  template: `
    <div class="mx-auto max-w-xl px-5 py-20">
      @if (error()) {
        <div class="card bg-base-200">
          <div class="card-body items-center text-center gap-4">
            <h1 class="font-display text-2xl font-semibold">This document could not be opened</h1>
            <div role="alert" class="alert alert-error alert-soft"><span>{{ error() }}</span></div>
            <a routerLink="/" class="btn btn-primary rounded-full">Back to documents</a>
          </div>
        </div>
      } @else {
        <div class="flex flex-col items-center gap-4 text-base-content/70" role="status">
          <span class="loading loading-spinner loading-lg text-primary"></span>
          <p>Opening the saved copy…</p>
        </div>
      }
    </div>
  `,
})
export class OpenSavedPage implements OnInit {
  private readonly queue = inject(DocumentQueueService);
  private readonly router = inject(Router);
  readonly serverId = input.required<string>();
  protected readonly error = signal<string | null>(null);

  async ngOnInit() {
    try {
      const localId = await this.queue.openSaved(this.serverId());
      await this.router.navigate(['/review', localId], { replaceUrl: true });
    } catch (e) {
      this.error.set(describeHttpError(e));
    }
  }
}
