import { Component } from '@angular/core';
import { Icon } from '../ui/icon';

@Component({
  selector: 'app-storage-notice',
  imports: [Icon],
  template: `
    <div role="note" class="flex items-center gap-3 rounded-box border border-success/25 bg-success/10 px-5 py-4 text-sm text-base-content">
      <span class="grid size-9 shrink-0 place-items-center rounded-full bg-success/15 text-primary">
        <app-icon name="warning" size="1.2rem" />
      </span>
      <p>Your progress and results are saved in this browser. Files awaiting approval stay here until you approve or discard them. Clearing site data removes everything saved here.</p>
    </div>
  `,
})
export class StorageNotice {}
