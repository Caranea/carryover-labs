import sharp from 'sharp';
import type { StoredPage } from './contract.js';
import { isJpeg, LIMITS, ManifestError } from './validate.js';
import { storedMaskGeometry } from './mask-geometry.js';

/** Decode pixels, validate dimensions, burn masks independently, strip all metadata. */
export async function sanitizePageImage(input: Buffer, page: StoredPage): Promise<Buffer> {
  if (!isJpeg(input) || input.length > LIMITS.imageBytes) throw new ManifestError('Pages must be valid JPEG images under 8 MB.');
  try {
    const decoder = sharp(input, { failOn: 'warning', limitInputPixels: LIMITS.imagePixels, sequentialRead: true });
    const metadata = await decoder.metadata();
    if (metadata.format !== 'jpeg' || metadata.width !== page.width || metadata.height !== page.height || (metadata.pages ?? 1) !== 1) {
      throw new ManifestError('The page image size does not match its document description.');
    }
    // Raw decode rejects truncated JPEGs and removes EXIF, thumbnails and embedded profiles.
    const { data, info } = await decoder.removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
    for (const { x, y, w, h } of storedMaskGeometry(page).boxes) {
      for (let row = y; row < y + h; row++) data.fill(0, (row * info.width + x) * info.channels, (row * info.width + x + w) * info.channels);
    }
    return await sharp(data, { raw: info }).jpeg({ quality: 90 }).toBuffer();
  } catch (error) {
    if (error instanceof ManifestError) throw error;
    throw new ManifestError('A page image is damaged or too large to open. Export it again and retry.');
  }
}
