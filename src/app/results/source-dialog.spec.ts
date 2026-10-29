import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { vi } from 'vitest';
import { DocumentsApi } from '../core/documents-api';
import { DEMO_RESULTS } from '../core/demo-data';
import { SourceDialog, correctionDraft, sourceText } from './source-dialog';

const observation = { ...DEMO_RESULTS.observations[0], valueText: '<2.5', unit: null, date: null, revision: 'revision-1' };

describe('source checking', () => {
  it('retains comparison signs and unknown fields when opening a correction', () => {
    const draft = correctionDraft(observation);
    expect(draft.valueText).toBe('<2.5');
    expect(draft.unit).toBe('');
    expect(draft.date).toBe('');
    draft.valueText = '<3';
    expect(observation.valueText).toBe('<2.5');
  });

  it('never places hidden words in the accessible source text', () => {
    const text = sourceText([{ t: 'Private Name', l: 0, h: true }, { t: null, l: 0 }, { t: 'TSH', l: 1 }, { t: '2.5', l: 1 }]);
    expect(text).toBe('[hidden] [hidden]\nTSH 2.5');
    expect(text).not.toContain('Private Name');
  });

  async function setup(api: Partial<DocumentsApi>) {
    TestBed.configureTestingModule({ imports: [SourceDialog], providers: [{ provide: DocumentsApi, useValue: api }, { provide: AuthService, useValue: { userId: signal<string | null>('account-a'), sessionRevision: signal(0) } }] });
    const fixture = TestBed.createComponent(SourceDialog);
    fixture.detectChanges();
    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    dialog.showModal = () => { dialog.setAttribute('open', ''); };
    dialog.close = () => { dialog.removeAttribute('open'); dialog.dispatchEvent(new Event('close')); };
    return fixture;
  }

  it('opens a fictional source without an account or any API request', async () => {
    const get = vi.fn(); const pageImage = vi.fn();
    const fixture = await setup({ get, pageImage });
    await fixture.componentInstance.open({ documentId: 'sample', documentName: 'Fictional document', page: 0, bbox: null, title: 'TSH', detail: '2.5', demoText: 'Fictional TSH 2.5' });
    fixture.detectChanges();
    expect(get).not.toHaveBeenCalled(); expect(pageImage).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Fictional TSH 2.5');
    expect(fixture.nativeElement.textContent).not.toContain('Check or correct this reading');
  });

  it('shows text sources and saves a checked reading with its revision', async () => {
    const corrected = { ...observation, confirmed: true };
    const get = vi.fn().mockResolvedValue({ pages: [{ index: 0, width: 0, height: 0, hasImage: false, words: [{ t: 'TSH <2.5', l: 0 }] }] });
    const correct = vi.fn().mockResolvedValue(corrected);
    const fixture = await setup({ get, correct });
    await fixture.componentInstance.open({ documentId: observation.documentId, documentName: 'Document', page: 0, bbox: null, title: 'TSH', detail: '<2.5', observation });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('TSH <2.5');
    const edit = [...fixture.nativeElement.querySelectorAll('button')].find((b: any) => b.textContent.includes('Check or correct')) as HTMLButtonElement;
    edit.click(); fixture.detectChanges(); await fixture.whenStable();
    const note = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    note.value = 'Checked against printed row'; note.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    const emitted = vi.fn(); fixture.componentInstance.corrected.subscribe(emitted);
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    expect(correct).toHaveBeenCalledWith(observation.documentId, observation.id, {
      name: observation.name, valueText: '<2.5', unit: null, date: null, note: 'Checked against printed row', expectedRevision: 'revision-1',
    });
    expect(emitted).toHaveBeenCalledWith(corrected);
  });

  it('closes and discards a source reply from a previous session, including a switch back to the same account', async () => {
    let resolve!: (value: unknown) => void;
    const get = vi.fn().mockReturnValue(new Promise((done) => { resolve = done; }));
    const fixture = await setup({ get });
    const opening = fixture.componentInstance.open({ documentId: 'private-a', documentName: 'Account A source', page: 0, bbox: null, title: 'Private reading', detail: '2.5' });
    const auth = TestBed.inject(AuthService);
    auth.userId.set('account-b'); auth.sessionRevision.update((n) => n + 1);
    auth.userId.set('account-a'); auth.sessionRevision.update((n) => n + 1);
    resolve({ pages: [{ index: 0, width: 0, height: 0, hasImage: false, words: [{ t: 'Account A secret', l: 0 }] }] });
    expect(await opening).toBe(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('dialog').open).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('Account A');
  });

  it('discards a correction reply after sign-out and clears its private draft', async () => {
    let resolve!: (value: unknown) => void;
    const get = vi.fn().mockResolvedValue({ pages: [{ index: 0, width: 0, height: 0, hasImage: false, words: [{ t: 'TSH', l: 0 }] }] });
    const correct = vi.fn().mockReturnValue(new Promise((done) => { resolve = done; }));
    const fixture = await setup({ get, correct });
    const component = fixture.componentInstance as any;
    await component.open({ documentId: observation.documentId, documentName: 'Private source', page: 0, bbox: null, title: 'TSH', detail: '<2.5', observation });
    component.form = { ...correctionDraft(observation), note: 'Private correction note' };
    const emitted = vi.fn(); component.corrected.subscribe(emitted);
    const saving = component.save();
    const auth = TestBed.inject(AuthService); auth.userId.set(null); auth.sessionRevision.update((n) => n + 1);
    fixture.detectChanges();
    resolve({ ...observation, confirmed: true }); await saving;
    expect(emitted).not.toHaveBeenCalled();
    expect(component.form.note).toBe('');
    expect(fixture.nativeElement.querySelector('dialog').open).toBe(false);
  });
});

