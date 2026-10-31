/// <reference lib="webworker" />
/**
 * On-device personal-data detection with a small multilingual token
 * classification model. Selects GPU/FP16 or CPU/Q8 before downloading weights;
 * the browser caches the selected export. Runs off the main thread.
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
import { gpuExportAvailable, selectDetectorVariant, type ModelDevice } from './model-selection';

let tokenizer: PreTrainedTokenizer | null = null;
let model: PreTrainedModel | null = null;
let id2label: Record<number, string> = {};
let prefix: number[] = [];
let suffix: number[] = [];

const post = (msg: NerResponse) => postMessage(msg);
class GpuLoadError extends Error {}

addEventListener('message', async ({ data }: MessageEvent<NerRequest>) => {
  if (data.type === 'load') {
    try {
      await load(data.modelId, data.wasmBase, data.gpuModelBase, data.forceCpu);
      post({ type: 'ready' });
    } catch (e) {
      post({
        type: e instanceof GpuLoadError ? 'gpu-load-error' : 'load-error',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  } else if (data.type === 'predict') {
    try {
      post({
        type: 'result',
        id: data.id,
        predictions: await predict(data.lines, (completed, total) =>
          post({ type: 'predict-progress', id: data.id, completed, total }),
        ),
      });
    } catch (e) {
      post({
        type: 'predict-error',
        id: data.id,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
});

async function load(
  modelId: string,
  wasmBase: string,
  gpuModelBase: string,
  forceCpu = false,
): Promise<void> {
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

  let cachedWeights = false;
  const progress_callback = (p: {
    status: string;
    file?: string;
    loaded?: number;
    total?: number;
  }) => {
    // Transformers also emits "download" progress while reading Cache Storage.
    // Do not present a local cache read as a second network download.
    if (cachedWeights) return;
    // Track the large model file separately: small setup files must not look like a completed download.
    if (!p.file?.endsWith('.onnx')) return;
    if (p.status === 'progress' && p.total) {
      const loaded = p.loaded ?? 0;
      post({ type: 'progress', fraction: loaded / p.total, loaded, total: p.total });
    }
    if (p.status === 'done') post({ type: 'load-stage', stage: 'starting' });
  };

  post({ type: 'load-stage', stage: 'preparing' });
  // No model/config/tokenizer downloads occur until WebGPU is checked.
  const gpu =
    !forceCpu &&
    (await selectDetectorVariant(navigator as unknown as ModelDevice)) === 'gpu-fp16' &&
    (await gpuExportAvailable(gpuModelBase));
  const initialize = async (useGpu: boolean) => {
    const weightsUrl = useGpu
      ? new URL('onnx/model_fp16.onnx', gpuModelBase).href
      : `https://huggingface.co/${modelId}/resolve/main/onnx/model_quantized.onnx`;
    try {
      cachedWeights = typeof caches !== 'undefined' && !!(await caches.match(weightsUrl));
    } catch {
      cachedWeights = false;
    }
    post({ type: 'backend', variant: useGpu ? 'gpu-fp16' : 'cpu-q8', cached: cachedWeights });
    post({ type: 'load-stage', stage: 'preparing' });
    env.allowLocalModels = useGpu;
    const source = useGpu ? new URL(gpuModelBase).pathname.replace(/\/$/, '') : modelId;
    const options = { progress_callback, local_files_only: useGpu };
    tokenizer = await AutoTokenizer.from_pretrained(source, options);
    post({ type: 'load-stage', stage: cachedWeights ? 'starting' : 'downloading' });
    model = await AutoModelForTokenClassification.from_pretrained(source, {
      ...options,
      dtype: useGpu ? 'fp16' : 'q8',
      device: useGpu ? 'webgpu' : 'wasm',
    });
    post({ type: 'load-stage', stage: 'starting' });
    // Test actual execution as well as adapter availability before declaring ready.
    const input_ids = new Tensor('int64', BigInt64Array.from([0n, 2n]), [1, 2]);
    const attention_mask = new Tensor('int64', BigInt64Array.from([1n, 1n]), [1, 2]);
    try {
      const outputs = await model({ input_ids, attention_mask });
      try {
        const logits = outputs['logits'] as Tensor;
        if (!logits || !Array.from(logits.data as Float32Array).every(Number.isFinite))
          throw new Error('Invalid model output');
      } finally {
        for (const value of Object.values(outputs)) if (value instanceof Tensor) value.dispose();
      }
    } finally {
      input_ids.dispose();
      attention_mask.dispose();
    }
  };
  if (gpu) {
    try {
      await initialize(true);
    } catch (error) {
      console.warn('GPU privacy checker setup failed; falling back to CPU.', error);
      // A failed WebGPU session may poison this runtime. The service must
      // terminate this worker and start CPU in a fresh one, not reuse it.
      throw new GpuLoadError(error instanceof Error ? error.message : String(error));
    }
  } else await initialize(false);

  const config = model!.config as unknown as { id2label?: Record<string, string> };
  id2label = Object.fromEntries(
    Object.entries(config.id2label ?? {}).map(([k, v]) => [Number(k), v]),
  );

  const withSpecial = tokenizer!.encode('', { add_special_tokens: true });
  const bos = withSpecial.length >= 2 ? withSpecial.slice(0, 1) : [];
  prefix = bos;
  suffix = withSpecial.slice(bos.length);
}

async function predict(
  lines: string[][],
  progress: (completed: number, total: number) => void,
): Promise<[string, number][]> {
  if (!tokenizer || !model) throw new Error('Model not loaded');
  const tok = tokenizer;
  const sequences = buildSequences(
    lines,
    (w) => tok.encode(w, { add_special_tokens: false }),
    prefix,
    suffix,
  );
  const total = lines.reduce((n, l) => n + l.length, 0);
  const out: [string, number][] = Array.from({ length: total }, () => ['O', 0]);

  let completed = 0;
  for (const seq of sequences) {
    const n = seq.ids.length;
    const input_ids = new Tensor('int64', BigInt64Array.from(seq.ids.map(BigInt)), [1, n]);
    const attention_mask = new Tensor('int64', new BigInt64Array(n).fill(1n), [1, n]);
    let logits: Tensor;
    try {
      ({ logits } = (await model({ input_ids, attention_mask })) as { logits: Tensor });
    } finally {
      input_ids.dispose();
      attention_mask.dispose();
    }
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
    logits.dispose();
    progress(++completed, sequences.length);
  }
  return out;
}
