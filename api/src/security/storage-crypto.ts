import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const MAGIC = Buffer.from('CLAB1');
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** AES-GCM binds each encrypted file to its account and path. Keys are never stored with data. */
export function encodeStored(data: Buffer, key: Buffer | undefined, context: string): Buffer {
  if (!key) return data;
  if (key.length !== 32) throw new Error('Storage encryption requires a 32-byte key.');
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), ciphertext]);
}

/** Legacy plaintext remains readable; migration must be an explicit operation. */
export function decodeStored(data: Buffer, key: Buffer | undefined, context: string): Buffer {
  if (!data.subarray(0, MAGIC.length).equals(MAGIC)) return data;
  if (!key || key.length !== 32) throw new Error('Encrypted storage cannot be opened without its key.');
  const header = MAGIC.length + NONCE_BYTES + TAG_BYTES;
  if (data.length < header) throw new Error('Encrypted storage is damaged.');
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(MAGIC.length, MAGIC.length + NONCE_BYTES));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(data.subarray(MAGIC.length + NONCE_BYTES, header));
  return Buffer.concat([decipher.update(data.subarray(header)), decipher.final()]);
}
