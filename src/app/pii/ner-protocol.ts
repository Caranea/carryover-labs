/** Messages between NerService and ner.worker.ts. */
import type { DetectorVariant } from './model-selection';

export const NER_MODEL_ID = 'bardsai/eu-pii-anonimization-multilang';

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
