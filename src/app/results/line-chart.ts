import { DatePipe } from '@angular/common';
import {
  Component,
  computed,
  ElementRef,
  inject,
  input,
  OnDestroy,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { calendarTimestamp } from './calendar-date';
import { niceScale } from './chart-scale';
export { niceScale } from './chart-scale';
import { RecordChart, RecordPoint, RecordSeries } from '@shared/records';

/** Series use colour, dash patterns, labels and a table; colour is never the only identifier. */
const SERIES_COLORS = ['#205ca0', '#ad431c', '#14714f', '#855e00'];
const SINGLE_COLOR = '#0d7a68';

const HEIGHT = 210;
const M = { top: 14, right: 18, bottom: 30, left: 52 };
const DAY = 86_400_000;

export interface PointPick {
  series: RecordSeries;
  point: RecordPoint;
}

interface Dot {
  key: string;
  series: RecordSeries;
  point: RecordPoint;
  x: number;
  y: number;
  t: number;
  color: string;
  label: string;
}

/**
 * One test (or a few that share a unit and scale) over time. The crosshair
 * snaps to the nearest date and lists every line's value there; clicking a
 * dot, or pressing Enter on it, opens the page it was read from.
 */
@Component({
  selector: 'app-line-chart',
  imports: [DatePipe],
  template: `
    @if (chart().series.length > 1) {
      <ul
        class="flex flex-wrap gap-x-4 gap-y-1 mb-2 text-sm text-base-content/80"
        aria-label="Lines on this chart"
      >
        @for (s of chart().series; track s.key; let i = $index) {
          <li class="flex items-center gap-1.5">
            <svg width="24" height="8" aria-hidden="true">
              <line
                x1="0"
                y1="4"
                x2="24"
                y2="4"
                [attr.stroke]="colorOf(i)"
                stroke-width="2"
                [attr.stroke-dasharray]="dashOf(i)"
              /></svg
            >{{ s.label }}
          </li>
        }
      </ul>
    }
    <div class="relative" (pointerleave)="hover.set(null)">
      <!-- Pointer convenience only: every dot is also reachable by keyboard. -->
      <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events -->
      <svg
        [attr.width]="width()"
        [attr.height]="height"
        [attr.viewBox]="'0 0 ' + width() + ' ' + height"
        class="block w-full overflow-visible select-none"
        role="group"
        [attr.aria-label]="summary() + ' Use the arrow keys to move between readings.'"
        (pointermove)="onMove($event)"
        (click)="onClick($event)"
      >
        <!-- Grid and y ticks -->
        @for (tick of geometry().yTicks; track tick.v) {
          <line
            [attr.x1]="m.left"
            [attr.x2]="width() - m.right"
            [attr.y1]="tick.y"
            [attr.y2]="tick.y"
            class="grid"
          />
          <text
            [attr.x]="m.left - 8"
            [attr.y]="tick.y"
            class="tick"
            text-anchor="end"
            dominant-baseline="middle"
          >
            {{ tick.label }}
          </text>
        }
        <!-- x ticks -->
        @for (tick of geometry().xTicks; track tick.t) {
          <text [attr.x]="tick.x" [attr.y]="height - 8" class="tick" text-anchor="middle">
            {{ tick.label }}
          </text>
        }
        <line
          [attr.x1]="m.left"
          [attr.x2]="width() - m.right"
          [attr.y1]="height - m.bottom"
          [attr.y2]="height - m.bottom"
          class="axis"
        />

        <!-- Crosshair -->
        @if (hovered(); as h) {
          <line
            [attr.x1]="h.x"
            [attr.x2]="h.x"
            [attr.y1]="m.top"
            [attr.y2]="height - m.bottom"
            class="crosshair"
          />
        }

        <!-- Lines -->
        @for (line of geometry().lines; track line.key) {
          <path
            [attr.d]="line.d"
            fill="none"
            [attr.stroke]="line.color"
            [attr.stroke-dasharray]="line.dash"
            stroke-width="2"
            stroke-linejoin="round"
            stroke-linecap="round"
          />
        }
        <!-- Dots: the visible mark, then a larger invisible target. One dot per chart is a tab stop; arrows move between them. -->
        @for (d of geometry().dots; track d.key; let i = $index) {
          <circle
            [attr.cx]="d.x"
            [attr.cy]="d.y"
            [attr.r]="hovered()?.t === d.t ? 6 : 4.5"
            [attr.fill]="d.point.comparator ? 'white' : d.color"
            [attr.stroke]="d.point.comparator ? d.color : 'white'"
            stroke-width="2"
          />
          <circle
            [attr.cx]="d.x"
            [attr.cy]="d.y"
            r="22"
            fill="transparent"
            class="hit"
            [attr.tabindex]="i === activeDot() ? 0 : -1"
            role="button"
            [attr.aria-label]="d.label"
            (focus)="hover.set(d.t); activeDot.set(i)"
            (blur)="hover.set(null)"
            (keydown)="onKey($event, d, i)"
            (click)="$event.stopPropagation(); pick.emit({ series: d.series, point: d.point })"
          />
        }
      </svg>

      @if (hovered(); as h) {
        <div class="tip" [style.left.px]="h.tipLeft" [style.top.px]="m.top" role="status">
          <p class="text-xs text-base-content/80 mb-1.5">{{ h.date | date: 'd MMM y' : 'UTC' }}</p>
          @for (d of h.dots; track d.key) {
            <div class="flex items-start gap-2 py-0.5">
              <span
                class="inline-block w-3 h-0.5 rounded-full mt-2 shrink-0"
                [style.background]="d.color"
              ></span>
              <div class="min-w-0">
                <p>
                  <span class="font-semibold tabular-nums">{{ display(d) }}</span>
                  <span class="text-base-content/80"> {{ unitLabel(d.series.unit) }}</span>
                  @if (chart().series.length > 1) {
                    <span class="text-base-content/80"> · {{ d.series.label }}</span>
                  }
                </p>
                <p class="text-xs text-base-content/80 truncate">
                  Printed “{{ d.point.printedName }}” {{ d.point.printedValue }}
                  {{ d.point.printedUnit ?? '' }}
                </p>
                <p class="text-xs text-base-content/80 truncate">
                  {{ d.point.documentName }}, page {{ d.point.page + 1 }}
                  @if (d.point.alsoIn.length) {
                    (and {{ d.point.alsoIn.length }} more)
                  }
                </p>
              </div>
            </div>
          }
          <p class="text-xs text-primary mt-1.5">
            Tap a dot or use the values table to open its source
          </p>
        </div>
      }
    </div>
    @if (hasLimits()) {
      <p class="text-sm text-base-content/80 mt-2">
        Hollow markers are reported limits, not exact values. Check &lt;, &gt;, ≤ or ≥ in the table.
      </p>
    }
    <details class="chart-table mt-3 border-t border-base-300 pt-2" [open]="showTable()">
      <summary class="cursor-pointer font-medium text-primary py-2">
        View values and sources
      </summary>
      <div class="overflow-x-auto" tabindex="0" aria-label="Chart values and source documents">
        <table class="table table-sm w-full">
          <caption class="sr-only">
            {{
              summary()
            }}
            Values and original source references.
          </caption>
          <thead>
            <tr>
              <th scope="col">Test</th>
              <th scope="col">Date</th>
              <th scope="col">Result</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            @for (s of chart().series; track s.key) {
              @for (p of s.points; track p.documentId + ':' + p.observationId) {
                <tr>
                  <th scope="row" class="font-medium">{{ s.label }}</th>
                  <td class="whitespace-nowrap">
                    {{ calendarDate(p.date) | date: 'd MMM y' : 'UTC' }}
                  </td>
                  <td class="tabular-nums">
                    {{ valueText(p) }} {{ unitLabel(s.unit) }}
                    @if (p.conversion) {
                      <span class="block text-xs text-base-content/80"
                        >Converted from {{ p.printedValue }} {{ p.printedUnit }}</span
                      >
                    }
                    @if (p.confirmed) {
                      <span class="block text-xs text-base-content/80"
                        >Checked against source by user</span
                      >
                    }
                  </td>
                  <td>
                    <span class="block">{{ p.documentName }}, page {{ p.page + 1 }}</span>
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm no-print"
                      (click)="pick.emit({ series: s, point: p })"
                      [attr.aria-label]="'Open source for ' + s.label + ' on ' + p.date"
                    >
                      View source
                    </button>
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>
    </details>
  `,
  styles: `
    :host {
      display: block;
    }
    .grid {
      stroke: var(--color-base-300);
      stroke-width: 1;
    }
    .axis {
      stroke: color-mix(in oklab, var(--color-base-content) 25%, transparent);
      stroke-width: 1;
    }
    .tick {
      font-size: 11px;
      fill: color-mix(in oklab, var(--color-base-content) 80%, transparent);
      font-variant-numeric: tabular-nums;
    }
    .crosshair {
      stroke: color-mix(in oklab, var(--color-base-content) 35%, transparent);
      stroke-width: 1;
    }
    .hit {
      cursor: pointer;
      outline: none;
    }
    .hit:focus-visible {
      stroke: var(--color-primary);
      stroke-width: 2;
    }
    .tip {
      position: absolute;
      z-index: 10;
      width: 15rem;
      pointer-events: none;
      padding: 0.6rem 0.75rem;
      border-radius: var(--radius-box);
      background: var(--color-base-100);
      border: 1px solid var(--color-base-300);
      box-shadow: 0 8px 24px rgb(22 48 44 / 0.12);
      font-size: 0.875rem;
    }
  `,
})
export class LineChart implements OnInit, OnDestroy {
  readonly chart = input.required<RecordChart>();
  readonly pick = output<PointPick>();
  readonly showTable = input(false);
  protected readonly hasLimits = computed(() =>
    this.chart().series.some((s) => s.points.some((p) => p.comparator)),
  );

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private observer: ResizeObserver | null = null;

  protected readonly calendarDate = calendarTimestamp;
  protected readonly m = M;
  protected readonly height = HEIGHT;
  protected readonly width = signal(600);
  /** The dot that is the chart's single tab stop. */
  protected readonly activeDot = signal(0);
  /** Hovered or focused date (ms). */
  protected readonly hover = signal<number | null>(null);

  protected readonly geometry = computed(() => {
    const series = this.chart().series;
    const w = this.width();
    const all = series.flatMap((s) =>
      s.points.map((p) => ({ t: calendarTimestamp(p.date), v: p.value })),
    );
    let t0 = Math.min(...all.map((p) => p.t));
    let t1 = Math.max(...all.map((p) => p.t));
    if (t1 - t0 < 60 * DAY) {
      t0 -= 120 * DAY;
      t1 += 120 * DAY;
    }
    const tPad = (t1 - t0) * 0.04;
    t0 -= tPad;
    t1 += tPad;
    const { lo, hi, ticks } = niceScale(
      Math.min(...all.map((p) => p.v)),
      Math.max(...all.map((p) => p.v)),
    );
    const x = (t: number) => M.left + ((t - t0) / (t1 - t0)) * (w - M.left - M.right);
    const y = (v: number) => M.top + (1 - (v - lo) / (hi - lo)) * (HEIGHT - M.top - M.bottom);

    const dots: Dot[] = [];
    const lines = series.map((s, i) => {
      const color = this.colorOf(i);
      const pts = s.points.map((p) => {
        const t = calendarTimestamp(p.date);
        const dot: Dot = {
          key: `${s.key}:${p.documentId}:${p.observationId}`,
          series: s,
          point: p,
          x: x(t),
          y: y(p.value),
          t,
          color,
          label: `${s.label} ${p.printedValue} ${p.printedUnit ?? ''}${flagWords(p.flag)} on ${p.date}, from ${p.documentName}. Open the page.`,
        };
        dots.push(dot);
        return dot;
      });
      return {
        key: s.key,
        color,
        dash: this.dashOf(i),
        d: pts
          .map(
            (p, k) =>
              `${k && !p.point.comparator && !pts[k - 1].point.comparator ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`,
          )
          .join(''),
      };
    });

    return {
      dots,
      lines,
      yTicks: ticks.map((v) => ({ v, y: y(v), label: formatTick(v) })),
      xTicks: timeTicks(t0, t1, w - M.left - M.right).map((tk) => ({ ...tk, x: x(tk.t) })),
    };
  });

  /** The dots at the hovered date, and where the tooltip goes. */
  protected readonly hovered = computed(() => {
    const t = this.hover();
    if (t === null) return null;
    const dots = this.geometry().dots.filter((d) => d.t === t);
    if (!dots.length) return null;
    const x = dots[0].x;
    const tipWidth = 240;
    const tipLeft = x + 14 + tipWidth > this.width() ? Math.max(0, x - 14 - tipWidth) : x + 14;
    return { t, x, date: new Date(t), dots, tipLeft };
  });

  protected readonly summary = computed(() => {
    const parts = this.chart().series.map(
      (s) => `${s.label}: ${s.points.length} ${s.points.length === 1 ? 'value' : 'values'}`,
    );
    return `Chart in ${this.chart().unit}. ${parts.join('; ')}.`;
  });

  ngOnInit() {
    const el = this.host.nativeElement;
    this.width.set(Math.max(160, el.clientWidth || 600));
    this.observer = new ResizeObserver(([entry]) =>
      this.width.set(Math.max(160, Math.floor(entry.contentRect.width))),
    );
    this.observer.observe(el);
  }

  ngOnDestroy() {
    this.observer?.disconnect();
  }

  protected unitLabel(unit: string): string {
    return formatUnit(unit);
  }

  protected colorOf(i: number): string {
    return this.chart().series.length === 1
      ? SINGLE_COLOR
      : SERIES_COLORS[i % SERIES_COLORS.length];
  }

  protected display(d: Dot): string {
    // As printed, unless it was converted to this chart's unit.
    return pointDisplay(d.point);
  }

  protected valueText(point: RecordPoint): string {
    return pointDisplay(point);
  }
  protected dashOf(i: number): string {
    return ['', '7 4', '2 4', '9 3 2 3'][i % 4];
  }

  /** Enter or Space opens the focused dot's page; arrows, Home and End move between dots. */
  protected onKey(e: KeyboardEvent, d: Dot, index: number) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.pick.emit({ series: d.series, point: d.point });
      return;
    }
    const last = this.geometry().dots.length - 1;
    const next = {
      ArrowRight: index + 1,
      ArrowDown: index + 1,
      ArrowLeft: index - 1,
      ArrowUp: index - 1,
      Home: 0,
      End: last,
    }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const target = Math.max(0, Math.min(last, next));
    const hits = (e.target as SVGElement).ownerSVGElement?.querySelectorAll<SVGElement>('.hit');
    hits?.[target]?.focus();
  }

  /** The crosshair snaps to the nearest date with a value. */
  protected onMove(e: PointerEvent) {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const px = ((e.clientX - rect.left) * this.width()) / rect.width;
    let best: Dot | null = null;
    for (const d of this.geometry().dots)
      if (!best || Math.abs(d.x - px) < Math.abs(best.x - px)) best = d;
    this.hover.set(best && Math.abs(best.x - px) < 60 ? best.t : null);
  }

  /** A click opens the dot nearest the pointer at the hovered date. */
  protected onClick(e: MouseEvent) {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const dots = this.geometry().dots;
    const index = nearestPointIndex(
      dots,
      ((e.clientX - rect.left) * this.width()) / rect.width,
      ((e.clientY - rect.top) * HEIGHT) / rect.height,
    );
    if (index >= 0) {
      const best = dots[index];
      this.pick.emit({ series: best.series, point: best.point });
    }
  }
}

/** Year ticks for long spans, months for short ones, thinned to fit. */
export function timeTicks(t0: number, t1: number, px: number): { t: number; label: string }[] {
  const years = (t1 - t0) / (365.25 * DAY);
  const maxTicks = Math.max(2, Math.floor(px / 70));
  const out: { t: number; label: string }[] = [];
  if (years >= 2) {
    const y0 = new Date(t0).getUTCFullYear() + 1;
    const y1 = new Date(t1).getUTCFullYear();
    const every = Math.max(1, Math.ceil((y1 - y0 + 1) / maxTicks));
    for (let y = y0; y <= y1; y += every) out.push({ t: Date.UTC(y, 0, 1), label: String(y) });
  } else {
    const start = new Date(t0);
    const months = Math.max(1, Math.round((t1 - t0) / (30.4 * DAY)));
    const every = [1, 2, 3, 6, 12].find((m) => months / m <= maxTicks) ?? 12;
    for (
      let d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
      d.getTime() <= t1;
      d.setUTCMonth(d.getUTCMonth() + every)
    ) {
      out.push({
        t: d.getTime(),
        label: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }),
      });
    }
  }
  return out;
}

function formatTick(v: number): string {
  if (Math.abs(v) >= 10000) return `${Math.round(v / 1000)}K`;
  return String(Number(v.toPrecision(4)));
}

function formatValue(v: number): string {
  return String(Number(v.toPrecision(4)));
}

/** "10^9/L" → "10⁹/L" for display. */
export function formatUnit(unit: string): string {
  return unit.replace(/\^(\d+)/g, (_, d: string) =>
    [...d].map((c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(c)]).join(''),
  );
}

/** Keep comparator semantics when changing display units. */
export function pointDisplay(point: RecordPoint): string {
  return point.conversion
    ? `${point.comparator ?? ''}${formatValue(point.value)}`
    : point.printedValue;
}
/** Touch selection must not depend on a preceding hover event. */
export function nearestPointIndex(
  points: { x: number; y: number }[],
  x: number,
  y: number,
  radius = 24,
): number {
  let best = -1;
  let distance = radius;
  points.forEach((point, index) => {
    const d = Math.hypot(point.x - x, point.y - y);
    if (d <= distance) {
      distance = d;
      best = index;
    }
  });
  return best;
}

/** The lab's flag in words, for screen readers: the chart shows it only as a red dot. */
function flagWords(flag: string | null | undefined): string {
  if (flag === 'H' || flag === 'HH') return ', flagged high by the lab,';
  if (flag === 'L' || flag === 'LL') return ', flagged low by the lab,';
  return flag === 'A' ? ', flagged abnormal by the lab,' : '';
}
