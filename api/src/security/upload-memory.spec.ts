import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';
import type { Request } from 'express';
import { PayloadTooLargeException } from '@nestjs/common';
import { boundedUploadMemory } from './upload-memory.js';

describe('aggregate upload memory budget', () => {
  it('limits the whole request across files and resets for a different request', async () => {
    const storage = boundedUploadMemory(5);
    const add = (req: Request, data: string) => new Promise<number>((resolve, reject) => {
      const file = { stream: Readable.from([Buffer.from(data)]) } as Express.Multer.File;
      storage._handleFile(req, file, (error, result) => error ? reject(error) : resolve(result?.size ?? 0));
    });
    const req = {} as Request;
    assert.equal(await add(req, '123'), 3);
    await assert.rejects(add(req, '456'), PayloadTooLargeException);
    assert.equal(await add({} as Request, '12345'), 5);
  });
});
