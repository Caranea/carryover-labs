import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { By } from '@angular/platform-browser';
import { vi } from 'vitest';
import { DocumentsApi } from '../core/documents-api';
import { DEMO_RESULTS } from '../core/demo-data';
import { RecoveryProposal, RecoveryResponse } from '../core/recovery';
import { SourceDialog } from './source-dialog';
import { canAcceptProposal, RecoveryPanel } from './recovery-panel';

const proposal: RecoveryProposal = { id: 'p1', page: 0, name: 'TSH', valueText: '2.5', unit: 'mIU/L', date: '2026-09-15', dateText: '15.09.2026', refText: null, words: [1, 2], bbox: null, evidence: { name: [1], value: [2], unit: [], date: [], reference: [] }, issues: [], state: 'pending', revision: 'p-revision', decidedAt: null, note: null };
const response = (): RecoveryResponse => ({ documentId: DEMO_RESULTS.documents[0].id, sourceRevision: 'source-revision', status: 'ready', modelName: 'Configured Meta model', activePage: 0, message: null, proposals: [structuredClone(proposal)], updatedAt: null, attempts: { '0': 1 }, limits: { maxWordsPerPage: 4000, maxCharactersPerPage: 20000, maxProposalsPerCall: 30, maxCallsPerDocument: 6, maxAttemptsPerPage: 2 } });

describe('reviewing recovered readings', () => {
  it('requires source inspection, a check and a note for this pending proposal', () => {
    expect(canAcceptProposal(proposal, false, true, 'Checked')).toBe(false);
    expect(canAcceptProposal(proposal, true, false, 'Checked')).toBe(false);
    expect(canAcceptProposal(proposal, true, true, ' ')).toBe(false);
    expect(canAcceptProposal({ ...proposal, state: 'rejected' }, true, true, 'Checked')).toBe(false);
    expect(canAcceptProposal(proposal, true, true, 'Checked source')).toBe(true);
  });
  async function setup() {
    const state = response();
    const api = { recovery: vi.fn().mockResolvedValue(state), findMissedReadings: vi.fn(), acceptRecoveredReading: vi.fn().mockResolvedValue({ ...state, proposals: [{ ...proposal, state: 'accepted' }] }), rejectRecoveredReading: vi.fn() };
    TestBed.configureTestingModule({ imports: [RecoveryPanel], providers: [{ provide: DocumentsApi, useValue: api }, { provide: AuthService, useValue: { userId: signal<string | null>('account-a'), sessionRevision: signal(0) } }] });
    const fixture = TestBed.createComponent(RecoveryPanel);
    fixture.componentRef.setInput('documents', DEMO_RESULTS.documents);
    fixture.detectChanges();
    await fixture.componentInstance.chooseDocument(state.documentId);
    fixture.detectChanges(); await fixture.whenStable();
    return { fixture, api };
  }
  it('never accepts on loading, then sends the checked proposal revision and updates only after success', async () => {
    const { fixture, api } = await setup();
    expect(api.acceptRecoveredReading).not.toHaveBeenCalled();
    expect(api.findMissedReadings).not.toHaveBeenCalled();
    const emitted = vi.fn(); fixture.componentInstance.accepted.subscribe(emitted);
    const source = fixture.debugElement.query(By.directive(SourceDialog)).componentInstance as SourceDialog;
    vi.spyOn(source, 'open').mockResolvedValue(true);
    const button = (label: string) => [...fixture.nativeElement.querySelectorAll('button')].find((b: any) => b.textContent.trim() === label) as HTMLButtonElement;
    expect(button('Accept checked reading').disabled).toBe(true);
    button('Inspect source page').click(); await fixture.whenStable(); fixture.detectChanges();
    const checkbox = fixture.nativeElement.querySelector('input[type=checkbox]') as HTMLInputElement;
    checkbox.checked = true; checkbox.dispatchEvent(new Event('change'));
    const note = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    note.value = 'Checked value, unit and date on source'; note.dispatchEvent(new Event('input'));
    await fixture.whenStable(); fixture.detectChanges();
    expect(button('Accept checked reading').disabled).toBe(false);
    button('Accept checked reading').click(); await fixture.whenStable(); fixture.detectChanges();
    expect(api.acceptRecoveredReading).toHaveBeenCalledWith(response().documentId, 'p1', { expectedRevision: 'p-revision', note: 'Checked value, unit and date on source' });
    expect(emitted).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.textContent).toContain('Accepted by you');
  });
  it('keeps a pending proposal when rejection fails and does not refresh chart data', async () => {
    const { fixture, api } = await setup();
    api.rejectRecoveredReading.mockRejectedValue(new Error('Server unavailable'));
    const emitted = vi.fn(); fixture.componentInstance.accepted.subscribe(emitted);
    const reject = [...fixture.nativeElement.querySelectorAll('button')].find((b: any) => b.textContent.trim() === 'Reject proposal') as HTMLButtonElement;
    reject.click(); await fixture.whenStable(); fixture.detectChanges();
    expect(emitted).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Proposed readings to check (1)');
    expect(fixture.nativeElement.querySelector('[role=alert]')).not.toBeNull();
  });

  it('clears proposals and private notes and ignores acceptance from the previous account', async () => {
    const { fixture, api } = await setup();
    let resolve!: (value: RecoveryResponse) => void;
    api.acceptRecoveredReading.mockReturnValue(new Promise((done) => { resolve = done; }));
    const component = fixture.componentInstance as any;
    const key = component.key(proposal);
    component.inspected.set(new Set([key])); component.confirmed.set(new Set([key])); component.notes[key] = 'Private review note';
    const emitted = vi.fn(); component.accepted.subscribe(emitted);
    const accepting = component.decide(proposal, 'accept');
    const auth = TestBed.inject(AuthService); auth.userId.set('account-b'); auth.sessionRevision.update((n) => n + 1);
    fixture.detectChanges();
    resolve({ ...response(), proposals: [{ ...proposal, state: 'accepted' }] }); await accepting;
    fixture.detectChanges();
    expect(emitted).not.toHaveBeenCalled(); expect(component.data()).toBeNull();
    expect(component.notes).toEqual({}); expect(component.documentId()).toBe('');
    expect(fixture.nativeElement.textContent).not.toContain('Private review note');
  });
});

