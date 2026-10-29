import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';

/** Where the user is in the add, check, view flow. */
@Component({
  selector: 'app-step-rail',
  template: `
    <ul class="steps text-sm w-full max-w-md" aria-label="Steps">
      <li class="step" [class.step-primary]="index() >= 0" [attr.aria-current]="index() === 0 ? 'step' : null">Add files</li>
      <li class="step" [class.step-primary]="index() >= 1" [attr.aria-current]="index() === 1 ? 'step' : null">Check &amp; approve</li>
      <li class="step" [class.step-primary]="index() >= 2" [attr.aria-current]="index() === 2 ? 'step' : null">Results</li>
    </ul>
  `,
})
export class StepRail {
  private readonly router = inject(Router);
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );
  protected readonly index = computed(() => (/^\/(results|demo|appointment)/.test(this.url()) ? 2 : /^\/(review|saved)/.test(this.url()) ? 1 : 0));
}

