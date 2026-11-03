import { DatePipe } from '@angular/common';
import { Component, ElementRef, signal, viewChild } from '@angular/core';
import { DEMO_DOCUMENTS, DemoDocument } from '../core/demo-documents';
import { Icon } from '../ui/icon';

const LANGUAGE: Record<string, string> = { pl: 'Polish', en: 'English', de: 'German' };

/** "See initial tests": the sample patient's original documents, every page as handed in. */
@Component({
  selector: 'app-demo-documents',
  imports: [DatePipe, Icon],
  template: `
    <button type="button" class="initial-tests" aria-haspopup="dialog" (click)="open()">
      <span class="stack" aria-hidden="true">
        @for (d of stack; track d.id) {
          <img [src]="d.thumb" alt="" />
        }
      </span>
      <span>
        <span class="title">See the originals <app-icon name="arrow-right" size="1.1rem" /></span>
        <span class="sub"
          >The {{ docs.length }} documents Jane brought: Polish PDFs and phone photos,
          2012–2024</span
        >
      </span>
    </button>

    <dialog #dialog class="modal" aria-labelledby="docs-h" (close)="selected.set(null)">
      <div #box class="modal-box max-w-6xl p-0">
        <header
          class="sticky top-0 z-10 flex items-start justify-between gap-4 p-5 border-b border-base-300 bg-base-100"
        >
          @if (selected(); as d) {
            <div class="min-w-0">
              <button
                type="button"
                class="btn btn-ghost btn-sm rounded-full -ml-3"
                (click)="show(null)"
              >
                <app-icon name="arrow-left" size="1rem" />All documents
              </button>
              <h2 id="docs-h" class="font-display text-xl font-semibold mt-1 break-words">
                {{ d.title }}
              </h2>
              <p class="text-sm text-base-content/80 mt-1">
                {{ d.name }} · {{ d.date | date: 'd MMM y' }} · {{ language(d) }} ·
                {{ kind(d) }}
              </p>
            </div>
          } @else {
            <div class="min-w-0">
              <h2 id="docs-h" class="font-display text-xl font-semibold">Initial tests</h2>
              <p class="mt-1 text-base-content/80">
                The {{ docs.length }} documents Jane Doe brought, oldest first: Polish lab reports,
                and phone photos of English and German results. Carryover read every value on the
                results page from these pages.
              </p>
            </div>
          }
          <button
            type="button"
            class="btn btn-ghost btn-circle shrink-0"
            aria-label="Close documents"
            (click)="close()"
          >
            <app-icon name="x" />
          </button>
        </header>

        <div class="p-4 sm:p-5">
          <p class="rounded-box bg-base-200 p-3 text-sm mb-5">
            <strong>De-identified sample:</strong> Jane Doe is a stand-in name. These pages are
            based on real reports, published with the owner's consent; names, labs, addresses and
            identifiers have been replaced.
          </p>

          @if (selected(); as d) {
            <div class="flex flex-col gap-6">
              @for (p of d.pages; track p.src; let i = $index) {
                <figure class="flex flex-col gap-2">
                  <img
                    [src]="p.src"
                    [width]="p.width"
                    [height]="p.height"
                    loading="lazy"
                    class="doc-page"
                    [alt]="d.name + ', page ' + (i + 1) + ' of ' + d.pages.length"
                  />
                  @if (d.pages.length > 1) {
                    <figcaption class="text-sm text-base-content/80">
                      Page {{ i + 1 }} of {{ d.pages.length }}
                    </figcaption>
                  }
                </figure>
              }
            </div>
            <nav class="flex flex-wrap justify-between gap-2 mt-6" aria-label="Other documents">
              @if (neighbour(d, -1); as prev) {
                <button type="button" class="btn btn-outline rounded-full" (click)="show(prev)">
                  <app-icon name="arrow-left" size="1rem" />{{ prev.date | date: 'd MMM y' }}
                </button>
              } @else {
                <span></span>
              }
              @if (neighbour(d, 1); as next) {
                <button type="button" class="btn btn-outline rounded-full" (click)="show(next)">
                  {{ next.date | date: 'd MMM y' }}<app-icon name="arrow-right" size="1rem" />
                </button>
              }
            </nav>
          } @else {
            <ul class="doc-grid">
              @for (d of docs; track d.id) {
                <li>
                  <button type="button" class="doc-card" (click)="show(d)">
                    <span class="doc-thumb">
                      <img [src]="d.thumb" alt="" loading="lazy" />
                      @if (d.pages.length > 1) {
                        <span class="doc-count">{{ d.pages.length }} pages</span>
                      }
                    </span>
                    <span class="font-semibold">{{ d.date | date: 'd MMM y' }}</span>
                    <span class="text-sm leading-snug">{{ d.title }}</span>
                    <span class="text-xs text-base-content/70"
                      >{{ language(d) }} · {{ d.kind === 'pdf' ? 'PDF' : 'Photo' }}</span
                    >
                    @if (d.note) {
                      <span class="text-xs text-base-content/70">{{ d.note }}</span>
                    }
                  </button>
                </li>
              }
            </ul>
          }
        </div>
      </div>
      <form method="dialog" class="modal-backdrop"><button>Close</button></form>
    </dialog>
  `,
  styles: `
    .initial-tests {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: center;
      gap: 1.25rem;
      width: 100%;
      padding: 1.1rem 1.25rem;
      border: 1px solid var(--color-base-300);
      border-radius: var(--radius-box);
      background: var(--color-base-200);
      color: var(--color-base-content);
      text-align: left;
      cursor: pointer;
      transition:
        border-color 0.15s,
        box-shadow 0.15s;
    }
    .initial-tests:hover {
      border-color: color-mix(in oklab, var(--color-primary) 45%, var(--color-base-300));
      box-shadow: 0 10px 24px -18px color-mix(in oklab, var(--color-primary) 70%, black);
    }
    .initial-tests:hover app-icon {
      transform: translateX(3px);
    }
    .initial-tests:focus-visible {
      outline: 3px solid var(--color-primary);
      outline-offset: 3px;
    }
    .stack {
      position: relative;
      width: 5rem;
      height: 5.6rem;
    }
    .stack img {
      position: absolute;
      top: 0;
      left: 0;
      width: 3.6rem;
      height: 4.8rem;
      object-fit: cover;
      object-position: top;
      border: 1px solid var(--color-base-300);
      border-radius: 0.3rem;
      background: #fff;
      box-shadow: 0 4px 12px -6px rgb(22 48 44 / 0.35);
    }
    .stack img:nth-child(1) {
      transform: translate(-2px, 6px) rotate(-9deg);
    }
    .stack img:nth-child(2) {
      transform: translate(10px, 2px) rotate(3deg);
    }
    .stack img:nth-child(3) {
      transform: translate(22px, 8px) rotate(12deg);
    }
    .title {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-family: var(--font-display);
      font-size: 1.2rem;
      font-weight: 600;
      line-height: 1.2;
    }
    .title app-icon {
      color: var(--color-primary);
      transition: transform 0.15s;
    }
    .sub {
      display: block;
      margin-top: 0.3rem;
      font-size: 0.9rem;
      line-height: 1.45;
      color: color-mix(in oklab, var(--color-base-content) 80%, transparent);
    }
    .doc-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr));
      gap: 1rem;
    }
    .doc-card {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      width: 100%;
      height: 100%;
      padding: 0.5rem 0.5rem 0.75rem;
      text-align: left;
      border-radius: var(--radius-box, 1rem);
      border: 1px solid var(--color-base-300);
      background: var(--color-base-100);
      cursor: pointer;
      transition:
        border-color 0.15s,
        box-shadow 0.15s,
        transform 0.15s;
    }
    .doc-card:hover {
      border-color: var(--color-primary);
      box-shadow: 0 6px 18px -10px rgb(0 0 0 / 0.35);
      transform: translateY(-2px);
    }
    .doc-card:focus-visible {
      outline: 3px solid var(--color-primary);
      outline-offset: 2px;
    }
    .doc-thumb {
      position: relative;
      display: block;
      aspect-ratio: 3 / 4;
      margin-bottom: 0.4rem;
      overflow: hidden;
      border-radius: calc(var(--radius-box, 1rem) * 0.6);
      background: var(--color-base-200);
    }
    .doc-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: top;
    }
    .doc-count {
      position: absolute;
      right: 0.4rem;
      bottom: 0.4rem;
      padding: 0.1rem 0.5rem;
      border-radius: 999px;
      font-size: 0.75rem;
      background: rgb(0 0 0 / 0.65);
      color: #fff;
    }
    .doc-page {
      display: block;
      width: 100%;
      height: auto;
      border: 1px solid var(--color-base-300);
      border-radius: calc(var(--radius-box, 1rem) * 0.5);
      background: #fff;
    }
    @media (prefers-reduced-motion: reduce) {
      .doc-card,
      .initial-tests {
        transition: none;
      }
      .doc-card:hover,
      .initial-tests:hover {
        transform: none;
      }
    }
  `,
})
export class DemoDocuments {
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly box = viewChild.required<ElementRef<HTMLElement>>('box');
  protected readonly docs = DEMO_DOCUMENTS;
  protected readonly selected = signal<DemoDocument | null>(null);
  /** A photo, a PDF and the German report, fanned out on the button. */
  protected readonly stack = ['jane-doe-039', 'jane-doe-lab-28', 'jane-doe-002'].flatMap(
    (id) => DEMO_DOCUMENTS.find((d) => d.id === id) ?? [],
  );

  open(documentId?: string) {
    this.show(this.docs.find((d) => d.id === documentId) ?? null);
    const el = this.dialog().nativeElement;
    if (!el.open) el.showModal();
  }
  close() {
    this.dialog().nativeElement.close();
  }
  protected show(d: DemoDocument | null) {
    this.selected.set(d);
    this.box().nativeElement.scrollTop = 0;
  }
  protected neighbour(d: DemoDocument, step: number): DemoDocument | null {
    return this.docs[this.docs.indexOf(d) + step] ?? null;
  }
  protected language(d: DemoDocument): string {
    return LANGUAGE[d.language] ?? d.language;
  }
  protected kind(d: DemoDocument): string {
    return d.kind === 'pdf'
      ? `PDF, ${d.pages.length} ${d.pages.length === 1 ? 'page' : 'pages'}`
      : 'Phone photo';
  }
}
