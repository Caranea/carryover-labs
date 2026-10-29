/** Messages between NerService and ner.worker.ts. */

export const NER_MODEL_ID = 'bardsai/eu-pii-anonimization-multilang';

export type NerRequest =
  | { type: 'load'; modelId: string; wasmBase: string }
  | { type: 'predict'; id: number; lines: string[][] };

export type NerResponse =
  | { type: 'progress'; fraction: number }
  | { type: 'ready' }
  | { type: 'load-error'; message: string }
  | { type: 'result'; id: number; predictions: [label: string, score: number][] }
  | { type: 'predict-error'; id: number; message: string };
