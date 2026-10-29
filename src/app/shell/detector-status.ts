import { Component, computed, inject } from '@angular/core';
import { NerService } from '../pii/ner.service';
import { Icon } from '../ui/icon';

/** Status of the on-device detector, always visible in the navbar. */
@Component({
  selector: 'app-detector-status',
  imports: [Icon],
  template: `
    @switch (ner.state()) {
      @case ('loading') {
        <div class="tooltip tooltip-bottom" data-tip="Downloading the on-device detector (about 280 MB, first time only)">
          <span class="badge badge-soft badge-primary gap-2 py-3" role="status">
            <span class="loading loading-spinner loading-xs"></span>
            <span class="hidden sm:inline">Preparing detector</span>
            <span class="tabular-nums">{{ percent() }}%</span>
          </span>
        </div>
      }
      @case ('ready') {
        <div class="tooltip tooltip-bottom" data-tip="Personal details are found on this device">
          <span class="badge badge-soft badge-success gap-1.5 py-3" role="status">
            <app-icon name="shield" size="0.95rem" />
            <span class="hidden sm:inline">Private detector ready</span>
          </span>
        </div>
      }
      @case ('unavailable') {
        <div class="tooltip tooltip-bottom" data-tip="The detector could not start; built-in patterns are used. Check pages carefully.">
          <span class="badge badge-soft badge-warning gap-1.5 py-3" role="status">
            <app-icon name="alert" size="0.95rem" />
            <span class="hidden sm:inline">Patterns only</span>
          </span>
        </div>
      }
    }
  `,
})
export class DetectorStatus {
  protected readonly ner = inject(NerService);
  protected readonly percent = computed(() => Math.round(this.ner.progress() * 100));
}
