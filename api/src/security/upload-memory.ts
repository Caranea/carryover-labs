import { PayloadTooLargeException } from '@nestjs/common';
import type { StorageEngine } from 'multer';
import { LIMITS } from '../documents/validate.js';

/** Multer's default limits are per file. Also bound the entire in-memory request. */
export function boundedUploadMemory(maxBytes = LIMITS.uploadBytes): StorageEngine {
  const totals = new WeakMap<object, number>();
  return {
    _handleFile(req, file, callback) {
      const chunks: Buffer[] = [];
      let size = 0;
      let finished = false;
      const fail = (error: Error) => {
        if (finished) return;
        finished = true;
        chunks.length = 0;
        callback(error);
      };
      file.stream.on('data', (chunk: Buffer) => {
        if (finished) return;
        const total = (totals.get(req) ?? 0) + chunk.length;
        totals.set(req, total);
        if (total > maxBytes) return fail(new PayloadTooLargeException('This upload is too large. Add fewer pages at a time.'));
        chunks.push(chunk);
        size += chunk.length;
      });
      file.stream.on('error', fail);
      file.stream.on('end', () => {
        if (finished) return;
        finished = true;
        callback(null, { buffer: Buffer.concat(chunks), size });
        chunks.length = 0;
      });
    },
    _removeFile(_req, file, callback) {
      file.buffer = Buffer.alloc(0);
      callback(null);
    },
  };
}
