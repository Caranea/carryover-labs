import type { BatchView } from '@shared/jobs';
import type { RecordsResponse } from '@shared/records';

const BATCH_KEY = 'carryover.processing.batch';

export interface PageSubmission {
  documentId: string;
  pageId: string;
  page: number;
  revision: string;
  /** The approved, redacted page image as a data URL. */
  image: string;
}

export type RecordsView = BatchView<RecordsResponse>;

/** Thrown for a full queue: wait and submit again, nothing is lost. */
export class BusyError extends Error {}

/**
 * The server answered and said no: live reading is switched off, today's limit is reached,
 * or the request was rejected. Asking again won't help, so the message is shown at once.
 */
export class ServerRefused extends Error {}

/**
 * HTTP calls to the batch job API. The batch ID is kept in this browser so a refresh
 * resumes the same server jobs instead of paying for the pages again.
 */
export class JobClient {
  /** Defaults to this browser's saved batch; the live demo passes a throwaway one. */
  constructor(readonly batchId = storedBatchId()) {}

  private get base(): string {
    return `/api/batches/${this.batchId}`;
  }

  async submitPage(page: PageSubmission): Promise<void> {
    await this.send('POST', '/pages', page);
  }

  async submitNormalization(body: {
    processingVersion: number;
    documents: unknown[];
  }): Promise<void> {
    await this.send('POST', '/normalize', body);
  }

  /**
   * The batch's jobs, answered on the next change or after `waitSeconds`. An expired batch
   * reads as empty, so its unsaved pages are simply sent again.
   */
  async view(since: number, waitSeconds: number, signal?: AbortSignal): Promise<RecordsView> {
    const timeout = AbortSignal.timeout((waitSeconds + 15) * 1000);
    const response = await fetch(`${this.base}?since=${since}&wait=${waitSeconds}`, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) throw await failure(response);
    return (await response.json()) as RecordsView;
  }

  /** Confirm a saved page or cancel it. Best effort: the server forgets it in any case. */
  async removePage(pageId: string, revision: string): Promise<void> {
    await fetch(
      `${this.base}/pages/${encodeURIComponent(pageId)}?revision=${encodeURIComponent(revision)}`,
      {
        method: 'DELETE',
      },
    ).catch(() => undefined);
  }

  async removeBatch(): Promise<void> {
    await fetch(this.base, { method: 'DELETE' }).catch(() => undefined);
  }

  private async send(method: string, path: string, body: unknown): Promise<void> {
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (response.status === 429) throw new BusyError((await failure(response)).message);
    if (!response.ok) throw await failure(response);
  }
}

async function failure(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => ({}))) as { message?: unknown };
  const message =
    typeof body.message === 'string'
      ? body.message
      : "Meta's service didn't answer. Wait a minute and try again.";
  // 502 and 504 come from a proxy in between and usually pass; 429 is handled as busy.
  const refused = response.status === 503 || (response.status >= 400 && response.status < 500);
  return refused && response.status !== 429 ? new ServerRefused(message) : new Error(message);
}

/** Ask the server to drop this browser's batch, if there is one. Never creates an ID. */
export async function forgetServerBatch(): Promise<void> {
  try {
    const id = localStorage.getItem(BATCH_KEY);
    if (id && /^[a-zA-Z0-9-]{1,80}$/.test(id))
      await fetch(`/api/batches/${id}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(5000),
      });
  } catch {
    /* Offline or no storage: the server forgets the batch within 15 minutes anyway. */
  }
}

function storedBatchId(): string {
  try {
    const existing = localStorage.getItem(BATCH_KEY);
    if (existing && /^[a-zA-Z0-9-]{1,80}$/.test(existing)) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(BATCH_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}
