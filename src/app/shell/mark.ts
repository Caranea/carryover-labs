import { Component, input } from '@angular/core';

/** Layered lab reports with matching teal rows. */
@Component({
  selector: 'app-mark',
  template: `
    <img src="favicon.svg" [attr.width]="size()" [attr.height]="size()" alt="" aria-hidden="true" />
  `,
  styles: ':host { flex-shrink: 0; } img { display: block; width: 100%; height: 100%; }',
  host: { class: 'inline-flex' },
})
export class Mark {
  readonly size = input(32);
}
