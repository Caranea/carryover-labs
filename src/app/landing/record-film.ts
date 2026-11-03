import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '../ui/icon';
import { DOCUMENTS, ROWS, STEPS, TRACED } from './record-film-data';
import { FILM_END, filmFrame } from './record-film-timeline';

/** Keeps the fixed header's height out of what counts as in view. */
const HEADER_HEIGHT = 80;

/**
 * "Three steps", shown on Jane Doe's reports: her pages open in a viewer, personal details are
 * blacked out, and each value appears in a real results table as its row is read. It plays once,
 * when its pages come into view, and ends with one value traced back to its page. With reduced motion, only
 * that finished state shows.
 */
@Component({
  selector: 'app-record-film',
  imports: [RouterLink, Icon],
  templateUrl: './record-film.html',
  styleUrl: './record-film.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecordFilm {
  private readonly destroyRef = inject(DestroyRef);
  private readonly viewer = viewChild.required<ElementRef<HTMLElement>>('viewer');
  private animationFrame = 0;

  protected readonly steps = STEPS;
  protected readonly documents = DOCUMENTS;
  protected readonly rows = ROWS;
  protected readonly tracedRow = ROWS[TRACED.row];

  /** The finished state, until there is a reason to play. */
  private readonly time = signal(FILM_END);
  protected readonly motionAllowed = signal(false);
  protected readonly finished = computed(() => this.time() >= FILM_END);
  protected readonly frame = computed(() => filmFrame(this.time()));

  constructor() {
    afterNextRender(() => {
      this.destroyRef.onDestroy(() => cancelAnimationFrame(this.animationFrame));
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      this.motionAllowed.set(true);
      this.time.set(0);

      const seen = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            seen.disconnect();
            this.play();
          }
        },
        // The viewer, not the whole section: that can be taller than a phone's screen.
        { threshold: 0.6, rootMargin: `-${HEADER_HEIGHT}px 0px 0px 0px` },
      );
      seen.observe(this.viewer().nativeElement);
      this.destroyRef.onDestroy(() => seen.disconnect());
    });
  }

  protected play() {
    cancelAnimationFrame(this.animationFrame);
    this.time.set(0);
    let last: number | null = null;
    const tick = (now: number) => {
      // A hidden tab stops the clock; the film picks up where it was.
      const elapsed = last === null ? 0 : Math.min(now - last, 50) / 1000;
      last = now;
      const t = Math.min(this.time() + elapsed, FILM_END);
      this.time.set(t);
      if (t < FILM_END) this.animationFrame = requestAnimationFrame(tick);
    };
    this.animationFrame = requestAnimationFrame(tick);
  }
}
