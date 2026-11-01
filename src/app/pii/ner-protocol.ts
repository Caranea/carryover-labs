/** Messages between NerService and ner.worker.ts. */
import type { DetectorVariant } from './model-selection';

export const NER_MODEL_ID = 'bardsai/eu-pii-anonimization-multilang';
/**
 * Pinned Hugging Face revision: an upstream change can't silently change what is hidden. The
 * same revision as the WebGPU export (scripts/prepare-gpu-model.py), so both paths run one model.
 */
export const NER_MODEL_REVISION = '62ca5712368705bac11b8fea19e42e65cce088dd';
/** The CPU (int8) weights at the pinned revision; also the Cache Storage key. */
export const NER_CPU_WEIGHTS_URL = `https://huggingface.co/${NER_MODEL_ID}/resolve/${NER_MODEL_REVISION}/onnx/model_quantized.onnx`;

export type NerRequest =
  | { type: 'load'; modelId: string; wasmBase: string; gpuModelBase: string; forceCpu?: boolean }
  | { type: 'predict'; id: number; lines: string[][] };

export type NerResponse =
  | { type: 'backend'; variant: DetectorVariant; cached?: boolean }
  | { type: 'load-stage'; stage: 'preparing' | 'downloading' | 'starting' }
  | { type: 'progress'; fraction: number; loaded: number; total: number }
  | { type: 'predict-progress'; id: number; completed: number; total: number }
  | { type: 'ready' }
  | { type: 'load-error'; message: string }
  | { type: 'gpu-load-error'; message: string }
  | { type: 'result'; id: number; predictions: [label: string, score: number][] }
  | { type: 'predict-error'; id: number; message: string };
