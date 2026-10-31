import {
  Component,
  computed,
  inject,
  input,
  OnDestroy,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../core/errors';
import { ResultsService } from '../core/results.service';
import { RecoveryProposal, RecoveryResponse } from '../core/recovery';
import { ResultsDocument } from '@shared/results';
import { SourceDialog } from './source-dialog';

/** The user has to inspect this exact proposal revision before it can be accepted. */
export function canAcceptProposal(
  proposal: RecoveryProposal,
  inspected: boolean,
  confirmed: boolean,
  note: string,
): boolean {
  return (
    proposal.state === 'pending' &&
    inspected &&
    confirmed &&
    note.trim().length > 0 &&
    note.trim().length <= 500
  );
}
const POLL_MS = 3000;
const MAX_POLLS = 24;

@Component({
  selector: 'app-recovery-panel',
  imports: [FormsModule, SourceDialog],
  templateUrl: './recovery-panel.html',
})
export class RecoveryPanel implements OnDestroy {
  readonly documents = input.required<ResultsDocument[]>();
  readonly accepted = output<void>();
  private readonly api = inject(ResultsService);
  private readonly source = viewChild.required(SourceDialog);
  protected readonly documentId = signal('');
  protected readonly page = signal(0);
  protected readonly data = signal<RecoveryResponse | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly paused = signal(false);
  protected readonly inspected = signal<ReadonlySet<string>>(new Set());
  protected readonly confirmed = signal<ReadonlySet<string>>(new Set());
  protected readonly notes: Partial<Record<string, string>> = {};
  protected readonly currentDocument = computed(() =>
    this.documents().find((d) => d.id === this.documentId()),
  );
  protected readonly pages = computed(() =>
    Array.from({ length: this.currentDocument()?.pageCount ?? 0 }, (_, index) => index),
  );
  protected readonly pending = computed(
    () => this.data()?.proposals.filter((p) => p.state === 'pending') ?? [],
  );
  protected readonly decided = computed(
    () => this.data()?.proposals.filter((p) => p.state !== 'pending') ?? [],
  );
  protected readonly attemptsOnPage = computed(
    () => this.data()?.attempts[String(this.page())] ?? 0,
  );
  private timer: ReturnType<typeof setTimeout> | null = null;
  private polls = 0;
  private version = 0;
  private destroyed = false;

  private current(version: number) {
    return !this.destroyed && version === this.version;
  }

  async chooseDocument(id: string) {
    this.version++;
    this.clearPoll();
    this.polls = 0;
    this.paused.set(false);
    this.documentId.set(id);
    this.page.set(0);
    this.data.set(null);
    this.error.set(null);
    this.inspected.set(new Set());
    this.confirmed.set(new Set());
    if (id) await this.load();
  }
  protected async checkProgress() {
    this.polls = 0;
    this.paused.set(false);
    await this.load();
  }
  private async load() {
    const id = this.documentId();
    const version = this.version;
    if (!id || this.destroyed) return;
    this.loading.set(true);
    try {
      const state = await this.api.recovery(id);
      if (!this.current(version)) return;
      this.data.set(state);
      this.error.set(null);
      this.schedulePoll(state);
    } catch (e) {
      if (this.current(version)) this.error.set(errorMessage(e));
    } finally {
      if (this.current(version)) this.loading.set(false);
    }
  }
  protected async start() {
    const state = this.data();
    if (!state || this.loading() || state.status === 'working' || state.status === 'unavailable')
      return;
    this.loading.set(true);
    this.error.set(null);
    this.paused.set(false);
    this.polls = 0;
    const version = this.version;
    try {
      const result = await this.api.findMissedReadings(state.documentId, {
        page: this.page(),
        expectedRevision: state.sourceRevision,
      });
      if (!this.current(version)) return;
      this.data.set(result);
      this.schedulePoll(result);
    } catch (e) {
      if (this.current(version)) this.error.set(errorMessage(e));
    } finally {
      if (this.current(version)) this.loading.set(false);
    }
  }
  protected key(p: RecoveryProposal) {
    return `${this.documentId()}:${p.id}:${p.revision}`;
  }
  protected seen(p: RecoveryProposal) {
    return this.inspected().has(this.key(p));
  }
  protected isConfirmed(p: RecoveryProposal) {
    return this.confirmed().has(this.key(p));
  }
  protected confirm(p: RecoveryProposal, checked: boolean) {
    const keys = new Set(this.confirmed());
    if (checked && this.seen(p)) keys.add(this.key(p));
    else keys.delete(this.key(p));
    this.confirmed.set(keys);
  }
  protected canAccept(p: RecoveryProposal) {
    return canAcceptProposal(p, this.seen(p), this.isConfirmed(p), this.notes[this.key(p)] ?? '');
  }
  protected async inspect(p: RecoveryProposal) {
    const version = this.version;
    if (!this.current(version)) return;
    const doc = this.currentDocument();
    if (!doc) return;
    const key = this.key(p);
    const loaded = await this.source().open({
      documentId: doc.id,
      documentName: doc.name,
      page: p.page,
      bbox: p.bbox,
      title: `Proposed: ${p.name}`,
      detail: `${p.valueText} ${p.unit ?? ''} · ${p.date ?? 'date unknown'}`,
    });
    if (loaded && this.current(version) && key === this.key(p))
      this.inspected.update((keys) => new Set([...keys, key]));
  }
  protected async decide(p: RecoveryProposal, action: 'accept' | 'reject') {
    if (this.loading() || p.state !== 'pending' || (action === 'accept' && !this.canAccept(p)))
      return;
    const id = this.documentId();
    const version = this.version;
    this.loading.set(true);
    this.error.set(null);
    try {
      const state =
        action === 'accept'
          ? await this.api.acceptRecoveredReading(id, p.id, {
              expectedRevision: p.revision,
              note: (this.notes[this.key(p)] ?? '').trim(),
            })
          : await this.api.rejectRecoveredReading(id, p.id, { expectedRevision: p.revision });
      if (!this.current(version)) return;
      this.data.set(state);
      if (action === 'accept') this.accepted.emit();
    } catch (e) {
      if (this.current(version)) this.error.set(errorMessage(e));
    } finally {
      if (this.current(version)) this.loading.set(false);
    }
  }
  private schedulePoll(state: RecoveryResponse) {
    this.clearPoll();
    if (state.status !== 'working') return;
    if (this.polls++ >= MAX_POLLS) {
      this.paused.set(true);
      return;
    }
    this.timer = setTimeout(() => void this.load(), POLL_MS);
  }
  private clearPoll() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
  ngOnDestroy() {
    this.destroyed = true;
    this.version++;
    this.clearPoll();
  }
}
