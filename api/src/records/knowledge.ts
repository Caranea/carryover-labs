import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeStored, encodeStored } from '../security/storage-crypto.js';
import type { CatalogueTest } from './catalogue.js';

/** Learned suggestions belong to one account, never the global catalogue. */
export interface Knowledge {
  version: 1;
  names: Record<string, { key: string | null; reason?: string }>;
  tests: CatalogueTest[];
  conversions: Record<string, { factor: number; note: string }>;
}

const EMPTY: Knowledge = { version: 1, names: {}, tests: [], conversions: {} };
const queues = new Map<string, Promise<unknown>>();

/** One writer per account directory, including separate request-scoped store instances. */
async function exclusive<T>(path: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(path) ?? Promise.resolve();
  const operation = previous.catch(() => undefined).then(work);
  queues.set(path, operation);
  try { return await operation; }
  finally { if (queues.get(path) === operation) queues.delete(path); }
}

/** A generation is discarded on document redaction/deletion. Old jobs cannot recreate it. */
export class KnowledgeStore {
  private initialising: Promise<void> | null = null;
  private generation: string | null = null;

  constructor(private readonly dir: string, private readonly key?: Buffer, private readonly context = dir) {}

  private async initialise(): Promise<void> {
    if (this.initialising) return this.initialising;
    this.initialising = exclusive(this.dir, async () => {
      try {
        const generation = (await readFile(join(this.dir, 'current'), 'utf8')).trim();
        if (!/^[a-f0-9-]{36}$/.test(generation)) throw new Error('Invalid knowledge generation');
        this.generation = generation;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const generation = randomUUID();
        await mkdir(join(this.dir, generation), { recursive: true });
        try {
          await writeFile(join(this.dir, 'current'), generation, { flag: 'wx', mode: 0o600 });
          this.generation = generation;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          this.generation = (await readFile(join(this.dir, 'current'), 'utf8')).trim();
          if (!/^[a-f0-9-]{36}$/.test(this.generation)) throw new Error('Invalid knowledge generation');
        }
      }
    });
    return this.initialising;
  }

  async get(): Promise<Knowledge> {
    await this.initialise();
    // A deleted generation is not an empty cache: fail before a stale job can send another prompt.
    const current = (await readFile(join(this.dir, 'current'), 'utf8')).trim();
    if (current !== this.generation) throw new Error('Documents changed while the automatic check was running.');
    try {
      const data = await readFile(this.file());
      const parsed = JSON.parse(decodeStored(data, this.key, this.context).toString('utf8')) as Knowledge;
      if (parsed.version !== 1 || !parsed.names || !Array.isArray(parsed.tests) || !parsed.conversions) {
        throw new Error('The saved model suggestions are not valid.');
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(EMPTY);
      throw error;
    }
  }

  /** Serialize read/change/write together; a failed write does not poison the queue. */
  async update(change: (k: Knowledge) => void): Promise<void> {
    await this.initialise();
    await exclusive(this.dir, async () => {
      const k = await this.get();
      change(k);
      const current = (await readFile(join(this.dir, 'current'), 'utf8')).trim();
      if (current !== this.generation) throw new Error('Documents changed while the automatic check was running.');
      const tmp = join(this.dir, this.generation!, `.knowledge-${randomUUID()}`);
      await writeFile(tmp, encodeStored(Buffer.from(JSON.stringify(k)), this.key, this.context), { mode: 0o600 });
      await rename(tmp, this.file());
    });
  }

  private file(): string { return join(this.dir, this.generation!, 'knowledge.json'); }
}

export function conversionKey(testKey: string, from: string, to: string): string {
  return `${testKey}|${from}|${to}`;
}
