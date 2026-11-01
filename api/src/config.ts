import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The api/ folder, whether running from src (tests) or dist. */
const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface AppConfig {
  port: number;
  listenHost: string;
  trustLoopbackProxy: boolean;
  /** Built Angular app, served from the same origin when present. */
  webRoot: string;
  /** Meta Model API endpoint, or null when no key is configured. */
  model: ModelEndpoint | null;
  /** Model calls running at once across all users. */
  modelConcurrency: number;
  /** Paid model calls allowed per UTC day across all users. */
  modelDailyCalls: number;
}

/** An OpenAI-compatible chat completions endpoint. */
export interface ModelEndpoint {
  baseUrl: string;
  apiKey: string;
  /** Development only: write every model request and raw answer here. */
  traceDir?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const envFile = resolve(API_ROOT, '.env');
  if (env === process.env && existsSync(envFile)) process.loadEnvFile(envFile);

  const port = Number(env['PORT'] ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be between 1 and 65535.');
  }
  const apiKey = env['META_MODEL_API_KEY'] ?? '';
  const modelConcurrency = Number(env['MODEL_CONCURRENCY'] ?? 8);
  if (!Number.isInteger(modelConcurrency) || modelConcurrency < 1 || modelConcurrency > 32) {
    throw new Error('MODEL_CONCURRENCY must be between 1 and 32.');
  }

  const modelDailyCalls = Number(env['MODEL_DAILY_CALLS'] ?? 1000);
  if (!Number.isInteger(modelDailyCalls) || modelDailyCalls < 1) {
    throw new Error('MODEL_DAILY_CALLS must be a whole number of at least 1.');
  }

  return {
    port,
    listenHost: env['HOST'] || '127.0.0.1',
    trustLoopbackProxy: env['TRUST_LOOPBACK_PROXY'] === 'true',
    webRoot: resolve(API_ROOT, env['WEB_ROOT'] ?? '../dist/carryover-labs/browser'),
    model: apiKey
      ? {
          baseUrl: env['META_MODEL_BASE_URL'] || 'https://api.meta.ai/v1',
          apiKey,
          traceDir: env['MODEL_TRACE_DIR'] ? resolve(API_ROOT, env['MODEL_TRACE_DIR']) : undefined,
        }
      : null,
    modelConcurrency,
    modelDailyCalls,
  };
}
