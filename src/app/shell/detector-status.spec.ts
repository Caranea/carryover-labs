import { settled } from '../../testing/settled';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { DetectorStatus } from './detector-status';
import { DocumentQueueService } from '../core/document-queue.service';
import { LocalHistory } from '../core/local-history';
import { ResultsService } from '../core/results.service';
import { ExtractionService } from '../extraction/extraction.service';
import { resultsReadyGuard } from '../core/results-ready.guard';
import type { DocumentManifest, LocalDocument, LocalStatus } from '../core/models';

@Component({ template: '' })
class Destination {}
function document(id: string, status: LocalStatus = 'review'): LocalDocument {
  return {
    localId: id,
    fileName: id + '.txt',
    name: 'Lab report',
    status,
    sourceKind: 'text',
    progress: status === 'reading' ? 0.35 : 0,
    message: status === 'reading' ? 'Opening page 1 of 2' : '',
    addedAt: 1,
    file: new File(['fictional'], id + '.txt'),
    pages: [
      {
        index: 0,
        width: 100,
        height: 100,
        image: null,
        imageUrl: null,
        ocr: false,
        regions: [],
        words: [
          { id: 0, text: 'Example', hidden: false, line: 0 },
          { id: 1, text: 'TSH', hidden: false, line: 1 },
        ],
      },
    ],
  };
}
async function setup() {
  const create = vi.fn(async (manifest: DocumentManifest) => ({
    id: crypto.randomUUID(),
    ...manifest,
    pageCount: manifest.pages.length,
    createdAt: '',
    updatedAt: '',
  }));
  TestBed.configureTestingModule({
    imports: [DetectorStatus],
    providers: [
      provideRouter([
        { path: 'documents', component: Destination },
        { path: 'results', component: Destination, canActivate: [resultsReadyGuard] },
      ]),
      {
        provide: ResultsService,
        useValue: {
          create,
          prepareBatch: vi.fn(),
          processing: signal({
            stage: 'idle',
            completed: 0,
            total: 0,
            running: 0,
            queued: 0,
            error: null,
          }),
        },
      },
      {
        provide: LocalHistory,
        useValue: {
          create,
          prepareBatch: vi.fn(),
          processing: signal({
            stage: 'idle',
            completed: 0,
            total: 0,
            running: 0,
            queued: 0,
            error: null,
          }),
        },
      },
      {
        provide: ExtractionService,
        useValue: { extract: vi.fn(async () => document('new').pages) },
      },
    ],
  });
  await TestBed.compileComponents();
  const queue = TestBed.inject(DocumentQueueService);
  const router = TestBed.inject(Router);
  const fixture = TestBed.createComponent(DetectorStatus);
  fixture.detectChanges();
  const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
  dialog.showModal = vi.fn(() => dialog.setAttribute('open', ''));
  dialog.close = vi.fn(() => {
    dialog.removeAttribute('open');
    dialog.dispatchEvent(new Event('close'));
  });
  const button = (label: string) =>
    [...dialog.querySelectorAll('button')].find((item) => item.textContent?.trim() === label)!;
  const begin = async (docs: LocalDocument[]) => {
    queue.documents.set(docs);
    queue.openReview();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const change = async (id: string, status: LocalStatus) => {
    queue.documents.update((docs) =>
      docs.map((doc) => (doc.localId === id ? { ...doc, status } : doc)),
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  return { fixture, dialog, queue, router, button, begin, change };
}

describe('continuous document review', () => {
  it('shows the restored selection in the picker as soon as its options are created', async () => {
    const { fixture, dialog, queue } = await setup();
    queue.documents.set([document('first'), document('second')]);
    queue.openReview('second');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect((dialog.querySelector('.document-picker select') as HTMLSelectElement).value).toBe(
      'second',
    );
    expect(dialog.querySelector('app-review [role="region"]')?.getAttribute('aria-label')).toBe(
      'second.txt',
    );
    fixture.destroy();
  });

  it('keeps a save rejection beside the approval button and clears it after correcting the name', async () => {
    const { fixture, dialog, queue, button, begin } = await setup();
    await begin([document('first')]);
    queue.rename('first', 'Report 97010112345');
    fixture.detectChanges();
    button('Approve and send').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(queue.byId('first')?.status).toBe('review');
    const approve = button('Approve and send');
    const alert = dialog.querySelector('#approval-error');
    expect(alert?.textContent).toContain('document name');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(approve.parentElement?.contains(alert)).toBe(true);
    expect(approve.getAttribute('aria-describedby')).toBe('approval-error');
    queue.rename('first', 'Thyroid tests');
    fixture.detectChanges();
    expect(dialog.querySelector('#approval-error')).toBeNull();
    button('Approve and send').click();
    await settled(() => expect(queue.byId('first')?.status).toBe('saved'));
    fixture.destroy();
  });

  it('opens the first ready document in the same dialog and keeps it selected as later files finish', async () => {
    const { fixture, dialog, queue, begin, change } = await setup();
    await begin([document('first', 'reading'), document('second', 'queued')]);
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain('2 still processing');
    expect(dialog.querySelector('[aria-current="step"]')?.textContent).toContain('Check & approve');
    expect(dialog.textContent).toContain('Preparing your documents');
    await change('first', 'review');
    await change('second', 'reading');
    const editor = dialog.querySelector('app-review');
    expect(editor?.querySelector('[role="region"]')?.getAttribute('aria-label')).toBe('first.txt');
    expect(dialog.textContent).toContain('1 ready to check');
    expect(dialog.textContent).toContain('1 still processing');
    queue.addRegion('first', 0, { x: 10, y: 10, w: 20, h: 20 });
    fixture.detectChanges();
    await change('second', 'review');
    expect(dialog.querySelector('app-review')).toBe(editor);
    expect(queue.reviewId()).toBe('first');
    expect(dialog.showModal).toHaveBeenCalledTimes(1);
    const picker = dialog.querySelector('.document-picker select') as HTMLSelectElement;
    picker.value = 'second';
    picker.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(dialog.querySelector('app-review [role="region"]')?.getAttribute('aria-label')).toBe(
      'second.txt',
    );
    picker.value = 'first';
    picker.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(queue.byId('first')?.pages[0].regions).toHaveLength(1);
    fixture.destroy();
  });

  it('approves a ready file while another is reading, waits in the modal, and unlocks Results only after both approvals', async () => {
    const { fixture, dialog, queue, router, button, begin, change } = await setup();
    await begin([document('first'), document('second', 'reading')]);
    const navigate = vi.spyOn(router, 'navigate');
    expect(button('Continue to Results').disabled).toBe(true);
    button('Approve and send').click();
    await settled(() => expect(queue.byId('first')?.status).toBe('saved'));
    fixture.detectChanges();
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain('Preparing the remaining documents');
    expect(dialog.textContent).toContain('1 / 2 approved');
    expect(button('Continue to Results').disabled).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
    await change('second', 'review');
    expect(dialog.querySelector('app-review [role="region"]')?.getAttribute('aria-label')).toBe(
      'second.txt',
    );
    expect(button('Continue to Results').disabled).toBe(true);
    button('Approve and send').click();
    await settled(() => expect(queue.byId('second')?.status).toBe('saved'));
    fixture.detectChanges();
    expect(dialog.textContent).toContain('All documents approved');
    expect(button('Continue to Results').disabled).toBe(false);
    button('Continue to Results').click();
    await settled(() => expect(router.url).toBe('/results'));
    fixture.detectChanges();
    expect(dialog.open).toBe(false);
    expect(dialog.querySelector('[aria-current="step"]')?.textContent?.trim()).toBe('Results');
    fixture.destroy();
  });

  it('blocks direct results navigation for waiting, review, saving and failed files', async () => {
    const { fixture, queue, router, begin, change } = await setup();
    await begin([document('unfinished', 'queued')]);
    for (const status of ['queued', 'reading', 'detecting', 'review', 'saving', 'error'] as const) {
      await change('unfinished', status);
      for (const destination of ['/results']) {
        queue.closeReview();
        await router.navigateByUrl(destination);
        fixture.detectChanges();
        expect(router.url).toBe('/documents');
        expect(queue.reviewOpened()).toBe(true);
      }
    }
    queue.remove('unfinished');
    fixture.detectChanges();
    await router.navigateByUrl('/results');
    fixture.detectChanges();
    expect(router.url).toBe('/results');
    fixture.destroy();
  });

  it('keeps dismissal respected and resolves failed files without a dead end', async () => {
    const { fixture, dialog, queue, button, begin, change } = await setup();
    await begin([
      document('first', 'detecting'),
      { ...document('broken', 'error'), error: 'Unreadable file' },
    ]);
    button('Continue in background').click();
    fixture.detectChanges();
    await change('first', 'review');
    expect(dialog.open).toBe(false);
    queue.openReview();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(button('Approve and send').disabled).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('I checked every page myself');
    button('Approve and send').click();
    await settled(() => expect(queue.byId('first')?.status).toBe('saved'));
    fixture.detectChanges();
    expect(button('Continue to Results').disabled).toBe(true);
    expect(dialog.textContent).toContain('Unreadable file');
    button('Remove from queue').click();
    fixture.detectChanges();
    expect(button('Continue to Results').disabled).toBe(false);
    fixture.destroy();
  });
});
