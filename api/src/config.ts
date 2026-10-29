import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** api/ folder, whether running from src (tests) or dist. */
export const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface AppConfig {
  port: number;
  listenHost: string;
  trustLoopbackProxy: boolean;
  storageDir: string;
  /** External base64-decoded AES-256 key. Never stored in the data directory. */
  storageEncryptionKey?: Buffer;
  /** Built Angular app, served in production when present. */
  webRoot: string;
  /** Muse Spark endpoints, tried in order. Empty when no keys are set: rules only. */
  models: ModelEndpoint[];
}

/** An OpenAI-compatible chat completions endpoint. */
export interface ModelEndpoint {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, options = { persistentStorage: true }): AppConfig {
  const envFile = resolve(API_ROOT, '.env');
  if (env === process.env && existsSync(envFile)) process.loadEnvFile(envFile);

  const encodedKey = env['STORAGE_ENCRYPTION_KEY'];
  const storageEncryptionKey = encodedKey ? Buffer.from(encodedKey, 'base64') : undefined;
  if (encodedKey && (!/^[A-Za-z0-9+/]{43}=$/.test(encodedKey) || storageEncryptionKey?.length !== 32)) {
    throw new Error('STORAGE_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }
  if (options.persistentStorage && env['NODE_ENV'] === 'production' && !storageEncryptionKey) {
    throw new Error('Production storage requires STORAGE_ENCRYPTION_KEY.');
  }
  const port = Number(env['PORT'] ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');

  return {
    port,
    listenHost: env['HOST'] || '127.0.0.1',
    trustLoopbackProxy: env['TRUST_LOOPBACK_PROXY'] === 'true',
    storageDir: resolve(API_ROOT, env['STORAGE_DIR'] ?? './storage'),
    storageEncryptionKey,
    webRoot: resolve(API_ROOT, env['WEB_ROOT'] ?? '../dist/carryover-labs/browser'),
    models: [
      {
        // Meta's open-weight model, served by Baseten.
        name: 'Muse Spark Open on Baseten',
        baseUrl: env['BASETEN_BASE_URL'] || 'https://inference.baseten.co/v1',
        apiKey: env['BASETEN_API_KEY'] ?? '',
        model: env['BASETEN_MODEL'] || 'meta-models/muse-spark-open-1026',
      },
      {
        name: 'Muse Spark on Meta Model API',
        baseUrl: env['META_MODEL_BASE_URL'] || 'https://api.meta.ai/v1',
        apiKey: env['META_MODEL_API_KEY'] ?? '',
        // Not the "-contributor" variant: that one lets Meta train on prompts, and these are lab results.
        model: env['META_MODEL'] || 'muse-spark-1.3',
      },
    ].filter((m) => m.apiKey),
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
