import { afterNextRender, Component, DestroyRef, ElementRef, inject, signal } from '@angular/core';
import { Icon } from '../ui/icon';

interface Point {
  label: string;
  value: number;
}

const POINTS: Point[] = [
  { label: '2022', value: 212 },
  { label: '2023', value: 183 },
  { label: '2024', value: 141 },
  { label: '2025', value: 168 },
  { label: '2026', value: 172 },
];
const W = 260;
const PLOT_HEIGHT = 96;
const H = PLOT_HEIGHT + 22;
const x = (i: number) => 16 + (i * (W - 32)) / (POINTS.length - 1);
const y = (v: number) => 10 + ((260 - v) * (PLOT_HEIGHT - 20)) / (260 - 120);

/**
 * The hero visual: a tilted stack of real Carryover UI cards, in the spirit of
 * daisyUI's homepage. An anonymized photo plays a short redaction sequence.
 * The final point matches its platelet count; earlier points are illustrative.
 */
@Component({
  selector: 'app-hero-stack',
  imports: [Icon],
  templateUrl: './hero-stack.html',
  styleUrl: './hero-stack.css',
})
export class HeroStack {
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly started = signal(false);
  protected readonly run = signal(0);
  protected readonly points = POINTS;
  protected readonly latest = POINTS[POINTS.length - 1];
  protected readonly w = W;
  protected readonly h = H;
  protected readonly plotHeight = PLOT_HEIGHT;
  protected readonly px = x;
  protected readonly py = y;
  protected readonly line = POINTS.map((p, i) => `${x(i)},${y(p.value)}`).join(' ');
  protected readonly removed = [
    'Patient name',
    'National ID / SSN',
    'Doctors and technicians',
    'Addresses and phones',
  ];

  constructor() {
    afterNextRender(() => {
      if (typeof IntersectionObserver === 'undefined') {
        this.started.set(true);
        return;
      }

      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.75)) {
            this.started.set(true);
            observer.disconnect();
          }
        },
        { threshold: 0.75, rootMargin: '-80px 0px -16px 0px' },
      );

      observer.observe(this.host.nativeElement);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  protected replay() {
    this.started.set(true);
    this.run.update((r) => r + 1);
  }
}
