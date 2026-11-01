import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Spark, SPARK_H, SPARK_W } from './table-layout';

/**
 * A test's trend: the line, the printed reference range as a shaded band, values the lab
 * flagged as red dots and the latest value as a dot. Stretches to any size; the dots stay round
 * because they are zero-length strokes with round caps.
 */
@Component({
  selector: 'app-spark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let s = spark();
    <svg [attr.viewBox]="'0 0 ' + w + ' ' + h" preserveAspectRatio="none" aria-hidden="true">
      @if (s.band; as b) {
        <rect class="band" x="0" [attr.y]="b.y" [attr.width]="w" [attr.height]="b.h" />
      }
      <polyline class="line" [attr.points]="s.line" />
      <path class="last" [attr.d]="'M' + s.last.x + ' ' + s.last.y + 'h0'" />
      @for (d of s.dots; track $index) {
        <path class="halo" [attr.d]="'M' + d.x + ' ' + d.y + 'h0'" />
        <path class="dot" [attr.d]="'M' + d.x + ' ' + d.y + 'h0'" />
      }
    </svg>
  `,
  styles: `
    :host {
      display: block;
      width: 7.5rem;
      height: 2.1rem;
    }
    svg {
      display: block;
      width: 100%;
      height: 100%;
      overflow: visible;
    }
    .band {
      fill: color-mix(in oklab, var(--color-primary) 13%, transparent);
    }
    path,
    polyline {
      vector-effect: non-scaling-stroke;
      fill: none;
    }
    .line {
      stroke: var(--color-primary);
      stroke-width: 1.5;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    path {
      stroke-linecap: round;
    }
    .last {
      stroke: var(--color-primary);
      stroke-width: 5;
    }
    .halo {
      stroke: #fff;
      stroke-width: 9;
    }
    .dot {
      stroke: var(--out, #b3261e);
      stroke-width: 6.5;
    }
  `,
})
export class SparkLine {
  readonly spark = input.required<Spark>();
  protected readonly w = SPARK_W;
  protected readonly h = SPARK_H;
}
