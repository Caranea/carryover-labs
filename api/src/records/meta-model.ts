import { Logger } from '@nestjs/common';
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
  reasoningEffort?: 'low';
  /** PNG or JPEG data URL for vision tasks. */
  image?: string;
}

const TIMEOUT_MS = 150_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const FAILED = 'The automatic check could not finish. You can retry it later.';

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
  if (!validate(value)) throw new Error('The model response did not match the required format.');
  return value as T;
}

/** Meta Model API over the OpenAI-compatible chat completions transport. */
export class MetaModelClient implements JsonModel {
  readonly name = 'Meta Model API';
  private readonly log = new Logger('MetaModel');

  constructor(private readonly endpoint: ModelEndpoint) {}

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
      // Provider errors can echo submitted content: never log or return their bodies.
      this.log.warn(
        `${task.kind}: ${task.model} failed (${error instanceof Error ? error.name : 'Error'})`,
      );
      throw new Error(FAILED);
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
      throw new Error(`Model request failed (HTTP ${res.status}).`);
    }
    const headersMs = Date.now() - sent;
    const data = JSON.parse(await boundedText(res)) as {
      choices?: { finish_reason?: string; message?: { content?: string | null } }[];
      usage?: Usage;
    };
    const choice = data.choices?.[0];
    if (choice?.finish_reason === 'length') throw new Error('The model response was truncated.');
    const answer = validateAnswer<T>(task, parseJson(choice?.message?.content ?? ''));
    return { answer, headersMs, usage: data.usage };
  }

  private post(body: unknown, signal: AbortSignal): Promise<Response> {
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
  if (!reader) throw new Error('The model returned an empty response.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('The model response was too large.');
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
    throw new Error('The model response was not valid text.');
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(content);
  const text = fenced ? fenced[1] : content;
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (start < 0 || end < start) throw new Error('The answer had no JSON');
  return JSON.parse(text.slice(start, end + 1));
}
