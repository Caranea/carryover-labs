import { Component, effect, ElementRef, inject, OnDestroy, viewChild } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './auth/auth.service';
import { DetectorStatus } from './shell/detector-status';
import { Mark } from './shell/mark';
import { Toasts } from './shell/toasts';
import { Icon } from './ui/icon';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Mark, DetectorStatus, Toasts, Icon],
  templateUrl: './app.html',
  host: { class: 'flex min-h-screen flex-col' },
})
export class App implements OnDestroy {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly userButton = viewChild<ElementRef<HTMLDivElement>>('userButton');
  private mounted: HTMLDivElement | null = null;

  constructor() {
    let priorOwner = this.auth.userId();
    let priorRevision = this.auth.sessionRevision();
    effect(() => {
      const owner = this.auth.userId();
      const revision = this.auth.sessionRevision();
      const changed = priorOwner !== null && (owner !== priorOwner || revision !== priorRevision);
      priorOwner = owner;
      priorRevision = revision;
      // Re-run the route guard and destroy views belonging to the previous session.
      if (changed) void this.router.navigateByUrl('/');
    });
    effect(() => {
      const el = this.userButton()?.nativeElement ?? null;
      const signedIn = this.auth.status() === 'signed-in';
      if (el && signedIn && el !== this.mounted) {
        this.mounted = el;
        void this.auth.mountUserButton(el);
      }
      if ((!el || !signedIn) && this.mounted) {
        void this.auth.unmountUserButton(this.mounted);
        this.mounted = null;
      }
    });
  }

  protected skipHref() { return this.router.url.split('#')[0] + '#main-content'; }
  protected skipToContent(event: Event) {
    event.preventDefault();
    document.getElementById('main-content')?.focus();
  }

  protected scrollToStart() {
    document.getElementById('start')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  ngOnDestroy() {
    if (this.mounted) void this.auth.unmountUserButton(this.mounted);
  }
}
