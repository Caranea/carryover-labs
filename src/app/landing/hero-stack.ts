import { Component, signal } from '@angular/core';
import { Icon } from '../ui/icon';

interface Point {
  label: string;
  country: string;
  value: number;
}

const POINTS: Point[] = [
  { label: '2018', country: 'PL', value: 212 },
  { label: '2019', country: 'PL', value: 183 },
  { label: '2019', country: 'DE', value: 141 },
  { label: '2020', country: 'AU', value: 168 },
  { label: '2021', country: 'PL', value: 245 },
];
const W = 260;
const H = 96;
const x = (i: number) => 8 + (i * (W - 16)) / (POINTS.length - 1);
const y = (v: number) => 10 + ((260 - v) * (H - 20)) / (260 - 120);

/**
 * The hero visual: a tilted stack of real Carryover UI cards, in the spirit of
 * daisyUI's homepage. The printout card plays a short redaction sequence.
 */
@Component({
  selector: 'app-hero-stack',
  imports: [Icon],
  templateUrl: './hero-stack.html',
  styleUrl: './hero-stack.css',
})
export class HeroStack {
  protected readonly run = signal(0);
  protected readonly points = POINTS;
  protected readonly w = W;
  protected readonly h = H;
  protected readonly px = x;
  protected readonly py = y;
  protected readonly line = POINTS.map((p, i) => `${x(i)},${y(p.value)}`).join(' ');
  protected readonly area = `${x(0)},${H} ${POINTS.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')} ${x(POINTS.length - 1)},${H}`;
  protected readonly rangeTop = y(260);
  protected readonly rangeBottom = y(150);
  protected readonly removed = [
    { label: 'Patient name', on: true },
    { label: 'PESEL', on: true },
    { label: 'Doctors and technicians', on: true },
    { label: 'Addresses and phones', on: true },
    { label: 'Results and ranges', on: false },
  ];

  protected replay() {
    this.run.update((r) => r + 1);
  }
}
