import { Logger } from '@nestjs/common';
import { Ajv, type ValidateFunction } from 'ajv';
import type { ModelEndpoint } from '../config.js';

/** Something that answers a prompt with JSON. The real one calls Muse Spark; tests use a stub. */
export interface JsonModel {
  readonly name: string;
  ask<T>(task: ModelTask): Promise<T>;
}

export interface ModelTask {
  /** Short name for logs: "map-names", "convert-unit", "review". */
  kind: string;
  system: string;
  user: string;
  /** JSON schema of the answer. */
  schema: Record<string, unknown>;
  /** Larger source-extraction answers contain word references for a full page. */
  maxTokens?: number;
  reasoningEffort?: 'low';
  model?: 'muse-spark-1.3' | 'muse-wonder-1.0';
  image?: string;
}

const TIMEOUT_MS = 150_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const ajv = new Ajv({ allErrors: false, strict: true });
const validators = new Map<string, ValidateFunction>();

/** Check the returned value, including providers that only support plain JSON. */
export function validateAnswer<T>(task: ModelTask, value: unknown): T {
  const key = JSON.stringify(task.schema);
  let validate = validators.get(key);
  if (!validate) {
    validate = ajv.compile(task.schema);
    // Keep only our bounded validator cache; Ajv otherwise retains each generated schema object.
    ajv.removeSchema(task.schema);
    // The schemas are generated from a bounded task set; do not retain arbitrary schemas forever.
    if (validators.size >= 32) validators.clear();
    validators.set(key, validate);
  }
  if (!validate(value)) throw new Error('The model response did not match the required format.');
  return value as T;
}

/** Existing Meta chat-completions transport, with page vision and explicit standard model selection. */
export class MuseSpark implements JsonModel {
  private readonly log = new Logger('MuseSpark');

  constructor(private readonly endpoints: ModelEndpoint[]) {}

  get name(): string {
    return this.endpoints.map((e) => e.name).join(', then ');
  }

  async ask<T>(task: ModelTask): Promise<T> {
    let lastError: unknown = null;
    for (const endpoint of this.endpoints) {
      // Standard Meta models only; never send private pages to an open/contributor variant.
      if (task.model && !/^muse-(spark|wonder)-[\d.]+$/.test(endpoint.model)) continue;
      try {
        const started = Date.now();
        const answer = await this.call<T>(endpoint, task);
        this.log.log(`${task.kind}: answered by ${endpoint.name} in ${Date.now() - started} ms`);
        return answer;
      } catch (e) {
        // Provider errors can echo submitted content. Never log their bodies or return them to users.
        lastError = new Error('The automatic check could not finish. You can retry it later.');
        this.log.warn(`${task.kind}: ${endpoint.name} failed (${e instanceof Error ? e.name : 'Error'})`);
      }
    }
    throw lastError ?? new Error('No model endpoint is configured');
  }

  private async call<T>(endpoint: ModelEndpoint, task: ModelTask): Promise<T> {
    const body = {
      model: task.model ?? endpoint.model,
      temperature: 0,
      max_tokens: task.maxTokens ?? 4096,
      ...(task.reasoningEffort ? { reasoning_effort: task.reasoningEffort } : {}),
      messages: [
        { role: 'system', content: task.system },
        { role: 'user', content: task.image ? [{ type: 'text', text: task.user }, { type: 'image_url', image_url: { url: task.image } }] : task.user },
      ],
      response_format: { type: 'json_schema', json_schema: { name: task.kind.replace(/\W/g, '_'), strict: true, schema: task.schema } },
    };
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    let res = await post(endpoint, body, signal);
    // Some deployments do not take a schema; ask for plain JSON instead and validate it ourselves.
    if (res.status === 400 || res.status === 422) {
      await res.body?.cancel();
      res = await post(endpoint, { ...body, response_format: { type: 'json_object' } }, signal);
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`Model request failed (HTTP ${res.status}).`);
    }
    const data = JSON.parse(await boundedText(res)) as { choices?: { finish_reason?: string; message?: { content?: string | null } }[] };
    if (data.choices?.[0]?.finish_reason === 'length') throw new Error('The model response was truncated.');
    const content = data.choices?.[0]?.message?.content ?? '';
    return validateAnswer<T>(task, parseJson<unknown>(content));
  }
}

async function post(endpoint: ModelEndpoint, body: unknown, signal: AbortSignal): Promise<Response> {
  return fetch(`${endpoint.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${endpoint.apiKey}` },
    body: JSON.stringify(body),
    signal,
  });
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
export function parseJson<T>(content: string): T {
  if (typeof content !== 'string' || content.length > MAX_RESPONSE_BYTES) throw new Error('The model response was not valid text.');
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(content);
  const text = fenced ? fenced[1] : content;
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (start < 0 || end < start) throw new Error('The answer had no JSON');
  return JSON.parse(text.slice(start, end + 1)) as T;
}
