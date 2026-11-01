import { Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Ajv, type ValidateFunction } from 'ajv';
import type { ModelEndpoint } from '../config.js';

/** Something that answers a task with schema-checked JSON. Tests use a stub. */
export interface JsonModel {
  readonly name: string;
  ask<T>(task: ModelTask, signal?: AbortSignal): Promise<T>;
}

export type MetaModel = 'muse-spark-1.3' | 'muse-wonder-1.0';

export interface ModelTask {
  /** Short name for logs, for example "transcribe-page". */
  kind: string;
  model: MetaModel;
  system: string;
  user: string;
  /** JSON schema of the answer. */
  schema: Record<string, unknown>;
  maxTokens?: number;
  /** Less hidden reasoning: faster and cheaper, for tasks that do not need it. */
  reasoningEffort?: 'low';
  /** PNG or JPEG data URL for vision tasks. */
  image?: string;
}

const TIMEOUT_MS = 240_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const FAILED = 'The automatic check could not finish. You can retry it later.';
/** Meta answers 429 or 5xx when it is busy: ask again, at most this many times. */
const BUSY_RETRIES = 2;

/** A failure described in our own words: safe to log, it never carries model or page text. */
export class ModelFailure extends Error {}
/** The answer hit the token limit. Asking about less at once can succeed. */
export class AnswerCutOff extends ModelFailure {}

interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

interface Answer<T> {
  answer: T;
  headersMs: number;
  usage?: Usage;
}

const ajv = new Ajv({ allErrors: false, strict: true });
const validators = new Map<string, ValidateFunction>();

/** Check a model answer against the task schema. */
export function validateAnswer<T>(task: Pick<ModelTask, 'schema'>, value: unknown): T {
  const key = JSON.stringify(task.schema);
  let validate = validators.get(key);
  if (!validate) {
    validate = ajv.compile(task.schema);
    ajv.removeSchema(task.schema);
    validators.set(key, validate);
  }
  if (!validate(value)) throw new ModelFailure('the answer did not match the required format');
  return value as T;
}

/** Meta Model API over the OpenAI-compatible chat completions transport. */
export class MetaModelClient implements JsonModel {
  readonly name = 'Meta Model API';
  private readonly log = new Logger('MetaModel');

  private traced = 0;

  /** `retryMs` is the first wait after a busy answer (shorter in tests). */
  constructor(
    private readonly endpoint: ModelEndpoint,
    private readonly retryMs = 2000,
  ) {
    if (endpoint.traceDir)
      this.log.warn(
        `Model trace is on: page images and answers are written to ${endpoint.traceDir}`,
      );
  }

  async ask<T>(task: ModelTask, signal?: AbortSignal): Promise<T> {
    const started = Date.now();
    try {
      const { answer, headersMs, usage } = await this.call<T>(task, signal);
      // Counts and timings only, never content: they show where the time and the credits go.
      this.log.log(
        `${task.kind}: ${task.model} answered in ${Date.now() - started} ms ` +
          `(headers after ${headersMs} ms, tokens in=${usage?.prompt_tokens ?? '?'} out=${usage?.completion_tokens ?? '?'})`,
      );
      return answer;
    } catch (error) {
      // Provider errors can echo submitted content: log only failures described in our words.
      const reason =
        error instanceof ModelFailure
          ? error.message
          : error instanceof Error
            ? error.name
            : 'Error';
      this.log.warn(
        `${task.kind}: ${task.model} failed after ${Date.now() - started} ms: ${reason}`,
      );
      throw error instanceof AnswerCutOff ? error : new Error(FAILED);
    }
  }

  private async call<T>(task: ModelTask, cancel?: AbortSignal): Promise<Answer<T>> {
    const content = task.image
      ? [
          { type: 'text', text: task.user },
          { type: 'image_url', image_url: { url: task.image } },
        ]
      : task.user;
    const body = {
      model: task.model,
      temperature: 0,
      max_tokens: task.maxTokens ?? 4096,
      ...(task.reasoningEffort ? { reasoning_effort: task.reasoningEffort } : {}),
      messages: [
        { role: 'system', content: task.system },
        { role: 'user', content },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: task.kind.replace(/\W/g, '_'), strict: true, schema: task.schema },
      },
    };
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const signal = cancel ? AbortSignal.any([timeout, cancel]) : timeout;
    const sent = Date.now();
    let res = await this.post(body, signal);
    // Some deployments reject a schema; ask for plain JSON and validate it here instead.
    if (res.status === 400 || res.status === 422) {
      await res.body?.cancel();
      res = await this.post({ ...body, response_format: { type: 'json_object' } }, signal);
    }
    if (!res.ok) {
      await res.body?.cancel();
      await this.trace(task, { status: res.status });
      throw new ModelFailure(`HTTP ${res.status}`);
    }
    const headersMs = Date.now() - sent;
    const data = JSON.parse(await boundedText(res)) as {
      choices?: { finish_reason?: string; message?: { content?: string | null } }[];
      usage?: Usage;
    };
    const choice = data.choices?.[0];
    await this.trace(task, {
      status: res.status,
      ms: Date.now() - sent,
      usage: data.usage,
      finishReason: choice?.finish_reason,
      content: choice?.message?.content ?? null,
    });
    if (choice?.finish_reason === 'length')
      throw new AnswerCutOff(
        `the answer was cut off at ${data.usage?.completion_tokens ?? '?'} tokens`,
      );
    const answer = validateAnswer<T>(task, parseJson(choice?.message?.content ?? ''));
    return { answer, headersMs, usage: data.usage };
  }

  /** Development only (MODEL_TRACE_DIR): the request, its page image and the raw answer. */
  private async trace(task: ModelTask, answer: Record<string, unknown>): Promise<void> {
    const dir = this.endpoint.traceDir;
    if (!dir) return;
    try {
      await mkdir(dir, { recursive: true });
      const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${++this.traced}-${task.kind}`;
      const image = task.image?.match(/^data:image\/(png|jpeg);base64,(.*)$/);
      if (image) await writeFile(join(dir, `${name}.${image[1]}`), Buffer.from(image[2], 'base64'));
      let user: unknown = task.user;
      try {
        user = JSON.parse(task.user);
      } catch {
        /* plain text */
      }
      await writeFile(
        join(dir, `${name}.json`),
        JSON.stringify(
          {
            kind: task.kind,
            model: task.model,
            maxTokens: task.maxTokens,
            system: task.system,
            user,
            ...answer,
          },
          null,
          1,
        ),
      );
    } catch (error) {
      this.log.warn(
        `Model trace could not be written (${error instanceof Error ? error.name : 'Error'})`,
      );
    }
  }

  private async post(body: unknown, signal: AbortSignal): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.send(body, signal);
      if (attempt === BUSY_RETRIES || (res.status !== 429 && res.status < 500)) return res;
      await res.body?.cancel();
      const after = Number(res.headers.get('retry-after'));
      this.log.warn(`Meta answered HTTP ${res.status}; asking again`);
      await sleep(
        Math.min(after > 0 ? after * 1000 : this.retryMs * 2 ** attempt, 10_000),
        undefined,
        {
          signal,
        },
      );
    }
  }

  private send(body: unknown, signal: AbortSignal): Promise<Response> {
    return fetch(`${this.endpoint.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.endpoint.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  }
}

async function boundedText(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) throw new ModelFailure('the answer was empty');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new ModelFailure('the answer was too large');
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** JSON from a model answer, tolerating code fences and text around it. */
export function parseJson(content: string): unknown {
  if (typeof content !== 'string' || content.length > MAX_RESPONSE_BYTES) {
    throw new ModelFailure('the answer was not text');
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(content);
  const text = fenced ? fenced[1] : content;
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (start < 0 || end < start) throw new ModelFailure('the answer had no JSON');
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    // JSON.parse quotes the text it failed on; keep it out of the logs.
    throw new ModelFailure('the answer was not valid JSON');
  }
}
