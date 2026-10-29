import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config.js';
import { compareStorage, copyEncryptedStorage, inventoryStorage, StorageOperationError } from './storage-operator.js';

const HELP = {
  commands: [
    'inventory --source PATH',
    'verify --source PATH',
    'copy-encrypt --source PATH --destination NEW_PATH [--apply --writers-stopped]',
    'compare --source PATH --destination PATH',
    'readiness --source PATH',
  ],
  keys: 'Use externally supplied STORAGE_SOURCE_KEY and STORAGE_TARGET_KEY environment variables, each base64-encoded 32 bytes. Never pass keys on the command line.',
  dryRun: 'copy-encrypt is a read-only dry run unless both --apply and --writers-stopped are supplied. The source is never changed. Stop the API and background writers before applying.',
};

export async function runStorageCommand(args: string[], env: NodeJS.ProcessEnv): Promise<{ exitCode: number; output: unknown }> {
  try {
    const { positionals, values } = parseArgs({ args, allowPositionals: true, strict: true, options: {
      source: { type: 'string' }, destination: { type: 'string' }, apply: { type: 'boolean' }, 'writers-stopped': { type: 'boolean' }, help: { type: 'boolean' },
    } });
    const command = positionals[0];
    if (values.help || !command) return { exitCode: 0, output: HELP };
    if (!values.source || positionals.length !== 1) throw new StorageOperationError('explicit-source-and-one-command-required');
    const sourceKey = key(env.STORAGE_SOURCE_KEY);
    if (command === 'inventory' || command === 'verify') {
      const report = await inventoryStorage(values.source, sourceKey);
      return { exitCode: report.verified ? 0 : 2, output: { command, report } };
    }
    if (command === 'copy-encrypt') {
      const targetKey = key(env.STORAGE_TARGET_KEY);
      if (!targetKey || !values.destination) throw new StorageOperationError('target-key-and-new-destination-required');
      const result = await copyEncryptedStorage({ source: values.source, destination: values.destination, sourceKey, targetKey, apply: values.apply, writersStopped: values['writers-stopped'] });
      return { exitCode: 0, output: { command, ...result } };
    }
    if (command === 'compare') {
      if (!values.destination) throw new StorageOperationError('destination-required');
      const equal = await compareStorage(values.source, values.destination, sourceKey, key(env.STORAGE_TARGET_KEY));
      return { exitCode: equal ? 0 : 2, output: { command, equal } };
    }
    if (command === 'readiness') {
      // Passing a clone explicitly avoids loading an actual .env behind the operator's back.
      const config = loadConfig({ ...env, NODE_ENV: 'production' });
      const report = await inventoryStorage(values.source, config.storageEncryptionKey);
      const authentication = !!config.clerkPublishableKey && !!config.clerkSecretKey;
      const httpsOrigins = config.authorizedParties.length > 0 && config.authorizedParties.every((origin) => {
        try { const url = new URL(origin); return url.protocol === 'https:' && url.origin === origin && !['localhost', '127.0.0.1'].includes(url.hostname); } catch { return false; }
      });
      const localGateway = config.listenHost === '127.0.0.1' && config.trustLoopbackProxy;
      const codeChecksPass = authentication && httpsOrigins && localGateway && report.verified && report.plaintextPayloads === 0;
      return { exitCode: codeChecksPass ? 0 : 2, output: {
        command, codeChecksPass, authenticationConfigured: authentication, httpsOriginsConfigured: httpsOrigins, loopbackGatewayConfigured: localGateway, report,
        operatorChecksStillRequired: ['HTTPS gateway and firewall verified', 'one API writer per store', 'separate secret recovery tested', 'backup restore tested', 'retention and deletion schedules approved', 'provider processing and retention terms reviewed', 'production access and log controls reviewed'],
      } };
    }
    throw new StorageOperationError('unknown-command');
  } catch (error) {
    // Raw filesystem/JSON/model errors may contain paths or medical text. Never print them.
    return { exitCode: 2, output: { error: error instanceof StorageOperationError ? error.code : 'operation-failed-check-paths-keys-and-configuration' } };
  }
}

function key(encoded: string | undefined): Buffer | undefined {
  if (!encoded) return undefined;
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new StorageOperationError('invalid-key-format');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length !== 32) throw new StorageOperationError('invalid-key-format');
  return bytes;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runStorageCommand(process.argv.slice(2), process.env);
  process.stdout.write(JSON.stringify(result.output, null, 2) + '\n');
  process.exitCode = result.exitCode;
}
