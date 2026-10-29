import { Component, inject } from '@angular/core';
import { ToastService } from '../core/toast.service';
import { Icon } from '../ui/icon';

@Component({
  selector: 'app-toasts',
  imports: [Icon],
  template: `
    <div class="toast toast-start toast-bottom z-50" aria-live="polite">
      @for (t of toasts.toasts(); track t.id) {
        <div role="alert" class="alert alert-success shadow-lg max-w-sm items-start">
          <app-icon name="check-circle" size="1.4rem" />
          <div>
            <p class="font-semibold">{{ t.title }}</p>
            @if (t.detail) {
              <p class="text-sm opacity-90">{{ t.detail }}</p>
            }
          </div>
          <button type="button" class="btn btn-ghost btn-sm btn-circle" (click)="toasts.dismiss(t.id)" aria-label="Dismiss">
            <app-icon name="x" size="1rem" />
          </button>
        </div>
      }
    </div>
  `,
})
export class Toasts {
  protected readonly toasts = inject(ToastService);
}
