import { DatePipe } from '@angular/common';
import { Component, ElementRef, signal, viewChild } from '@angular/core';
import { DEMO_DOCUMENTS, DemoDocument } from '../core/demo-documents';
import { Icon } from '../ui/icon';

const LANGUAGE: Record<string, string> = { pl: 'Polish', en: 'English', de: 'German' };

/** "See the originals": the sample patient's original documents, every page as handed in. */
@Component({
  selector: 'app-demo-documents',
  imports: [DatePipe, Icon],
  template: `
    <button
      type="button"
      class="originals btn btn-outline rounded-full w-full"
      aria-haspopup="dialog"
      (click)="open()"
    >
      <app-icon name="file-text" size="1.1rem" />See the originals
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
    /* Same size as the Meta AI button beside it. */
    .originals {
      height: 3.75rem;
      padding-inline: 1.25rem;
      font-size: 1.05rem;
      font-weight: 600;
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
      .doc-card {
        transition: none;
      }
      .doc-card:hover {
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
