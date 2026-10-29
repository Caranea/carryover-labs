import { Component, input } from '@angular/core';

/** The Carryover mark: three lines of a lab printout, one removed, one highlighted. */
@Component({
  selector: 'app-mark',
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="#0d7a68" />
      <rect x="8" y="9" width="16" height="3" rx="1.5" fill="#bfe3da" />
      <rect x="8" y="14.5" width="11" height="3" rx="1" fill="#000" />
      <rect x="8" y="20" width="14" height="3" rx="1.5" fill="#fcd34d" />
    </svg>
  `,
  host: { class: 'inline-flex' },
})
export class Mark {
  readonly size = input(32);
}
