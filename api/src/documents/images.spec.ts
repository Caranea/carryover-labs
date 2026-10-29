import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import sharp from 'sharp';
import type { StoredPage } from './contract.js';
import { sanitizePageImage } from './images.js';

const page: StoredPage = { index: 0, width: 80, height: 80, hasImage: true, ocr: false, regions: [[8, 8, 30, 30]], words: [] };
describe('image boundary', () => {
  it('fully decodes, removes metadata and independently burns masks', async () => {
    const input = await sharp({ create: { width: 80, height: 80, channels: 3, background: '#fff' } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    assert.ok((await sharp(input).metadata()).exif);
    const output = await sanitizePageImage(input, page);
    const metadata = await sharp(output).metadata();
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.orientation, undefined);
    const raw = await sharp(output).raw().toBuffer();
    assert.ok(raw[(20 * 80 + 20) * 3] < 10);
    assert.ok(raw[(60 * 80 + 60) * 3] > 240);
  });
  it('rejects signature-only, truncated and dimension-mismatched files', async () => {
    await assert.rejects(sanitizePageImage(Buffer.from([255, 216, 255, 224]), page), /damaged/);
    const valid = await sharp({ create: { width: 80, height: 80, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    await assert.rejects(sanitizePageImage(valid.subarray(0, valid.length - 20), page), /damaged/);
    await assert.rejects(sanitizePageImage(valid, { ...page, width: 70 }), /size/);
  });

  it('burns the whole closed chain without adding another padded footprint', async () => {
    const input = await sharp({ create: { width: 80, height: 80, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    const closed: StoredPage = { ...page, regions: [], words: [10, 22, 34].map((x) => ({ t: null, h: true, l: 0, b: [x, 10, 10, 10] })) };
    const output = await sanitizePageImage(input, closed);
    const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => data[(y * info.width + x) * info.channels];
    assert.ok(pixel(15, 15) < 20);
    assert.ok(pixel(27, 15) < 20);
    assert.ok(pixel(39, 15) < 20);
    assert.ok(pixel(50, 15) > 230, 'pixels outside the agreed footprint stay visible');
  });
});
