import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Box, WorkingPage, WorkingWord } from '../core/models';
import { boxFromPoints } from '../redaction/geometry';
import { redactionAction, redactionPlan } from '../redaction/burn';
import { describeWord } from './describe';

export type EditMode = 'words' | 'draw' | 'corners';

/**
 * One page image with the redaction drawn on top, exactly as it will be
 * burned in. Click a word to hide or show it; in draw mode, drag a box.
 */
@Component({
  selector: 'app-page-view',
  imports: [FormsModule],
  template: `
    <label class="flex gap-3 items-center mb-2 text-sm">Page size<select class="select w-36" [ngModel]="zoom()" (ngModelChange)="zoom.set(+$event)"><option [ngValue]="100">Fit width</option><option [ngValue]="200">200%</option><option [ngValue]="300">300%</option></select></label>
    <div class="overflow-auto max-h-[75vh]" tabindex="0" aria-label="Document page. Scroll to inspect it or use the text-only view.">
    <div class="sheet" [style.width.%]="zoom()" [style.aspect-ratio]="page().width + ' / ' + page().height">
      @if (page().imageUrl) {
        <img [src]="page().imageUrl" alt="Document page. Use Text only above to read and hide words with the keyboard." draggable="false" />
      }
      <svg
        [attr.viewBox]="'0 0 ' + page().width + ' ' + page().height"
        preserveAspectRatio="none"
        [class.drawing]="mode() !== 'words'"
        [class.reveal]="reveal()"
        (pointerdown)="startDraw($event)"
        (pointermove)="moveDraw($event)"
        (pointerup)="endDraw($event)"
        (pointercancel)="cancelDraw()"
        aria-hidden="true"
      >
        @for (w of visibleWords(); track w.id) {
          <rect
            class="word"
            [attr.x]="w.box!.x"
            [attr.y]="w.box!.y"
            [attr.width]="w.box!.w"
            [attr.height]="w.box!.h"
            (click)="clickWord(w)"
          >
            <title>{{ w.text }}: click to remove</title>
          </rect>
        }
        @for (h of hiddenBoxes(); track h.word.id) {
          <rect
            class="redacted"
            [class.locked]="h.locked"
            [attr.x]="h.box.x"
            [attr.y]="h.box.y"
            [attr.width]="h.box.w"
            [attr.height]="h.box.h"
            (click)="clickHidden(h.index)"
          >
            <title>{{ h.word.hidden ? describe(h.word) : 'Covered by a nearby hidden detail. Click to undo the original removal.' }}</title>
          </rect>
        }
        @for (r of plan().regionBoxes; track $index) {
          <rect
            class="region"
            [class.locked]="$index < (page().lockedRegions ?? 0)"
            [attr.x]="r.x"
            [attr.y]="r.y"
            [attr.width]="r.w"
            [attr.height]="r.h"
            (click)="clickRegion($index)"
          >
            <title>{{ $index < (page().lockedRegions ?? 0) ? 'Already removed' : 'Area you drew: click to undo' }}</title>
          </rect>
        }
        @if (draft(); as d) {
          <rect class="draft" [attr.x]="d.x" [attr.y]="d.y" [attr.width]="d.w" [attr.height]="d.h" />
        }
      </svg>
    </div></div>
    @if (mode() === 'corners') {
      <p role="status" class="text-sm mt-2">{{ draft() ? 'Now tap the opposite corner to hide the rectangle.' : 'Tap one corner of the area to hide, then its opposite corner.' }}</p>
      @if (draft()) { <button type="button" class="btn btn-ghost btn-sm" (click)="cancelDraw()">Cancel area</button> }
    }
    <details class="mt-3 border border-base-300 rounded-box p-3">
      <summary class="font-medium cursor-pointer py-1">Hide an area using the keyboard</summary>
      <form (ngSubmit)="addByNumbers()" class="mt-3 space-y-3">
        <p class="text-sm">Enter a rectangle as percentages of the page. Left and top set its starting position; width and height set its size.</p>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <label>Left %<input class="input w-full" type="number" name="left" min="0" max="99" [(ngModel)]="area.left" required /></label>
          <label>Top %<input class="input w-full" type="number" name="top" min="0" max="99" [(ngModel)]="area.top" required /></label>
          <label>Width %<input class="input w-full" type="number" name="width" min="1" max="100" [(ngModel)]="area.width" required /></label>
          <label>Height %<input class="input w-full" type="number" name="height" min="1" max="100" [(ngModel)]="area.height" required /></label>
        </div>
        @if (areaError()) { <p role="alert" class="text-error">{{ areaError() }}</p> }
        <button type="submit" class="btn btn-outline">Hide this area</button>
      </form>
    </details>
    @if (page().regions.length) {
      <ul class="text-sm mt-2">@for (region of page().regions; track $index) {
        <li class="flex flex-wrap items-center justify-between gap-2 py-1">Hidden area {{ $index + 1 }} · {{ describeRegion(region) }}
          @if ($index >= (page().lockedRegions ?? 0)) { <button type="button" class="btn btn-ghost btn-sm" (click)="removeRegion.emit($index)" [attr.aria-label]="'Remove hidden area ' + ($index + 1)">Undo area</button> } @else { <span>Already saved</span> }
        </li>
      }</ul>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .sheet {
      position: relative;
      width: 100%;
      background: #fff;
      border-radius: 0.5rem;
      overflow: hidden;
      box-shadow: 0 1px 2px rgba(22, 48, 44, 0.08), 0 12px 32px -16px rgba(22, 48, 44, 0.35);
      user-select: none;
      -webkit-user-select: none;
    }
    img,
    svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }
    svg {
      touch-action: pan-y pinch-zoom;
    }
    svg.drawing {
      cursor: crosshair;
      touch-action: none;
    }
    .word {
      fill: transparent;
      cursor: pointer;
    }
    svg:not(.drawing) .word:hover {
      fill: color-mix(in oklab, var(--color-accent) 45%, transparent);
      stroke: var(--color-primary);
      stroke-width: 1.5;
      vector-effect: non-scaling-stroke;
    }
    .redacted,
    .region {
      fill: #000;
      cursor: pointer;
    }
    svg:not(.drawing) .redacted:not(.locked):hover,
    svg:not(.drawing) .region:not(.locked):hover {
      fill: #2b3a37;
    }
    .reveal .redacted:not(.locked),
    .reveal .region:not(.locked) {
      fill: rgba(0, 0, 0, 0.08);
      stroke: #000;
      stroke-width: 2;
      stroke-dasharray: 5 3;
      vector-effect: non-scaling-stroke;
    }
    .locked {
      cursor: not-allowed;
    }
    svg.drawing .word,
    svg.drawing .redacted,
    svg.drawing .region {
      pointer-events: none;
    }
    .draft {
      fill: rgba(0, 0, 0, 0.55);
      stroke: var(--color-primary);
      stroke-width: 2;
      vector-effect: non-scaling-stroke;
    }
  `,
})
export class PageView {
  readonly page = input.required<WorkingPage>();
  readonly mode = input<EditMode>('words');
  readonly reveal = input(false);

  readonly toggleWord = output<number>();
  readonly addRegion = output<Box>();
  readonly removeRegion = output<number>();

  protected readonly draft = signal<Box | null>(null);
  protected readonly zoom = signal(100);
  protected readonly areaError = signal<string | null>(null);
  protected area = { left: 0, top: 0, width: 100, height: 10 };
  protected cancelDraw() { this.start = null; this.draft.set(null); }
  protected addByNumbers() {
    const box = percentageBox(this.area, this.page());
    if (!box) { this.areaError.set('Use positive sizes and keep the rectangle inside the page (position plus size must be 100% or less).'); return; }
    this.areaError.set(null); this.addRegion.emit(box);
  }
  protected describeRegion(b: Box): string { return `${Math.round(b.x / this.page().width * 100)}% from left, ${Math.round(b.y / this.page().height * 100)}% from top`; }
  private start: { x: number; y: number } | null = null;

  protected readonly plan = computed(() => redactionPlan(this.page()));
  protected readonly visibleWords = computed(() => this.page().words.filter((w, i) => !this.plan().hidden.has(i) && w.box));
  protected readonly hiddenBoxes = computed(() => {
    const p = this.page();
    const plan = this.plan();
    return [...plan.wordBoxes].map(([index, box]) => ({ index, word: p.words[index], box, locked: redactionAction(p, index, plan) === null }));
  });

  protected describe(w: WorkingWord) {
    return describeWord(w, true);
  }

  protected clickWord(w: WorkingWord) {
    if (this.mode() === 'words' && !w.locked) this.toggleWord.emit(w.id);
  }

  protected clickHidden(index: number) {
    if (this.mode() !== 'words') return;
    const action = redactionAction(this.page(), index, this.plan());
    if (action && 'wordId' in action) this.toggleWord.emit(action.wordId);
    else if (action) this.removeRegion.emit(action.regionIndex);
  }

  protected clickRegion(index: number) {
    if (this.mode() === 'words' && index >= (this.page().lockedRegions ?? 0)) this.removeRegion.emit(index);
  }

  protected startDraw(e: PointerEvent) {
    if (this.mode() !== 'draw') return;
    const pt = this.toPage(e);
    if (!pt) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    this.start = pt;
    this.draft.set({ x: pt.x, y: pt.y, w: 0, h: 0 });
  }

  protected moveDraw(e: PointerEvent) {
    if (!this.start) return;
    const pt = this.toPage(e);
    if (pt) this.draft.set(boxFromPoints(this.start.x, this.start.y, pt.x, pt.y));
  }

  protected endDraw(e: PointerEvent) {
    if (this.mode() === 'corners' && !this.start) {
      const pt = this.toPage(e);
      if (pt) { this.start = pt; this.draft.set({ ...pt, w: 0, h: 0 }); }
      return;
    }
    if (!this.start) return;
    const pt = this.toPage(e);
    const box = pt ? boxFromPoints(this.start.x, this.start.y, pt.x, pt.y) : this.draft();
    this.start = null;
    this.draft.set(null);
    if (box && box.w >= 4 && box.h >= 4) this.addRegion.emit(clamp(box, this.page()));
  }

  private toPage(e: PointerEvent): { x: number; y: number } | null {
    const svg = (e.currentTarget as SVGSVGElement).ownerSVGElement ?? (e.currentTarget as SVGSVGElement);
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const p = this.page();
    return {
      x: ((e.clientX - rect.left) / rect.width) * p.width,
      y: ((e.clientY - rect.top) / rect.height) * p.height,
    };
  }
}

function clamp(b: Box, page: WorkingPage): Box {
  const x = Math.max(0, b.x);
  const y = Math.max(0, b.y);
  return { x, y, w: Math.min(page.width, b.x + b.w) - x, h: Math.min(page.height, b.y + b.h) - y };
}

export function percentageBox(area: { left: number; top: number; width: number; height: number }, page: Pick<WorkingPage, 'width' | 'height'>): Box | null {
  const { left, top, width, height } = area;
  if (![left, top, width, height].every(Number.isFinite) || left < 0 || top < 0 || width <= 0 || height <= 0 || left + width > 100 || top + height > 100) return null;
  return { x: left * page.width / 100, y: top * page.height / 100, w: width * page.width / 100, h: height * page.height / 100 };
}
