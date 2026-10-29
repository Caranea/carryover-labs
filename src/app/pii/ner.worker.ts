/// <reference lib="webworker" />
/**
 * On-device personal-data detection with a small multilingual token
 * classification model (XLM-RoBERTa, quantised to 8 bits, ~280 MB, cached by
 * the browser after the first download). Runs off the main thread.
 */
import {
  AutoModelForTokenClassification,
  AutoTokenizer,
  env,
  PreTrainedModel,
  PreTrainedTokenizer,
  Tensor,
} from '@huggingface/transformers';
import { aggregateWord, softmax } from './labels';
import type { NerRequest, NerResponse } from './ner-protocol';
import { buildSequences } from './ner-sequences';

let tokenizer: PreTrainedTokenizer | null = null;
let model: PreTrainedModel | null = null;
let id2label: Record<number, string> = {};
let prefix: number[] = [];
let suffix: number[] = [];

const post = (msg: NerResponse) => postMessage(msg);

addEventListener('message', async ({ data }: MessageEvent<NerRequest>) => {
  if (data.type === 'load') {
    try {
      await load(data.modelId, data.wasmBase);
      post({ type: 'ready' });
    } catch (e) {
      post({ type: 'load-error', message: e instanceof Error ? e.message : String(e) });
    }
  } else if (data.type === 'predict') {
    try {
      post({ type: 'result', id: data.id, predictions: await predict(data.lines) });
    } catch (e) {
      post({ type: 'predict-error', id: data.id, message: e instanceof Error ? e.message : String(e) });
    }
  }
});

async function load(modelId: string, wasmBase: string): Promise<void> {
  env.allowLocalModels = false;
  const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number } };
  if (onnx.wasm) {
    // Serve the ONNX runtime from this app instead of a CDN.
    onnx.wasm.wasmPaths = {
      mjs: `${wasmBase}ort-wasm-simd-threaded.asyncify.mjs`,
      wasm: `${wasmBase}ort-wasm-simd-threaded.asyncify.wasm`,
    };
    // Threads need cross-origin isolation; fall back to one thread otherwise.
    if (!self.crossOriginIsolated) onnx.wasm.numThreads = 1;
  }

  const files = new Map<string, { loaded: number; total: number }>();
  const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status !== 'progress' || !p.file || !p.total) return;
    files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    post({ type: 'progress', fraction: total ? loaded / total : 0 });
  };

  tokenizer = await AutoTokenizer.from_pretrained(modelId, { progress_callback });
  model = await AutoModelForTokenClassification.from_pretrained(modelId, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback,
  });

  const config = model.config as unknown as { id2label?: Record<string, string> };
  id2label = Object.fromEntries(Object.entries(config.id2label ?? {}).map(([k, v]) => [Number(k), v]));

  const withSpecial = tokenizer.encode('', { add_special_tokens: true });
  const bos = withSpecial.length >= 2 ? withSpecial.slice(0, 1) : [];
  prefix = bos;
  suffix = withSpecial.slice(bos.length);
}

async function predict(lines: string[][]): Promise<[string, number][]> {
  if (!tokenizer || !model) throw new Error('Model not loaded');
  const tok = tokenizer;
  const sequences = buildSequences(lines, (w) => tok.encode(w, { add_special_tokens: false }), prefix, suffix);
  const total = lines.reduce((n, l) => n + l.length, 0);
  const out: [string, number][] = Array.from({ length: total }, () => ['O', 0]);

  for (const seq of sequences) {
    const n = seq.ids.length;
    const input_ids = new Tensor('int64', BigInt64Array.from(seq.ids.map(BigInt)), [1, n]);
    const attention_mask = new Tensor('int64', new BigInt64Array(n).fill(1n), [1, n]);
    const { logits } = (await model({ input_ids, attention_mask })) as { logits: Tensor };
    const data = logits.data as Float32Array;
    const classes = logits.dims[2];

    for (const span of seq.spans) {
      const probs: number[][] = [];
      for (let t = span.start; t < span.end; t++) {
        probs.push(softmax(data.subarray(t * classes, (t + 1) * classes)));
      }
      const best = aggregateWord(probs, id2label);
      out[span.word] = [best.label, best.score];
    }
  }
  return out;
}
