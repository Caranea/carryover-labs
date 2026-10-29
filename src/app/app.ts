import { afterNextRender, Component, ElementRef, inject, Injector, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { DetectorStatus } from './shell/detector-status';
import { Mark } from './shell/mark';
import { Toasts } from './shell/toasts';
import { Icon } from './ui/icon';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Mark, DetectorStatus, Toasts, Icon],
  templateUrl: './app.html',
  styleUrl: './app.css',
  host: {
    class: 'flex min-h-screen flex-col',
    '(document:keydown.escape)': 'closeMenu(true)',
    '(document:click)': 'onDocumentClick($event)',
    '(document:focusin)': 'onDocumentClick($event)',
  },
})
export class App {
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly navigation = viewChild<ElementRef<HTMLElement>>('navigation');
  private readonly menuToggle = viewChild<ElementRef<HTMLButtonElement>>('menuToggle');
  protected readonly menuOpen = signal(false);

  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationEnd) this.closeMenu();
    });
  }

  protected toggleMenu() {
    this.menuOpen.update((open) => !open);
    if (this.menuOpen()) {
      afterNextRender(() => {
        if (this.menuOpen()) this.navigation()?.nativeElement.querySelector('a')?.focus();
      }, { injector: this.injector });
    }
  }

  protected closeMenu(restoreFocus = false) {
    if (!this.menuOpen()) return;
    this.menuOpen.set(false);
    if (restoreFocus) this.menuToggle()?.nativeElement.focus();
  }

  protected onDocumentClick(event: Event) {
    if (event.target instanceof Element && !event.target.closest('.app-header')) {
      this.closeMenu();
    }
  }

  protected skipHref() { return this.router.url.split('#')[0] + '#main-content'; }
  protected skipToContent(event: Event) {
    event.preventDefault();
    document.getElementById('main-content')?.focus();
  }

  protected scrollToStart() {
    document.getElementById('start')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

}
