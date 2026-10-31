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
}

/** An OpenAI-compatible chat completions endpoint. */
export interface ModelEndpoint {
  baseUrl: string;
  apiKey: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const envFile = resolve(API_ROOT, '.env');
  if (env === process.env && existsSync(envFile)) process.loadEnvFile(envFile);

  const port = Number(env['PORT'] ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be between 1 and 65535.');
  }
  const apiKey = env['META_MODEL_API_KEY'] ?? '';

  return {
    port,
    listenHost: env['HOST'] || '127.0.0.1',
    trustLoopbackProxy: env['TRUST_LOOPBACK_PROXY'] === 'true',
    webRoot: resolve(API_ROOT, env['WEB_ROOT'] ?? '../dist/carryover-labs/browser'),
    model: apiKey
      ? { baseUrl: env['META_MODEL_BASE_URL'] || 'https://api.meta.ai/v1', apiKey }
      : null,
  };
}
