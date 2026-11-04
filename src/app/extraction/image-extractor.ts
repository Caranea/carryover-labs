import { createCanvas, MAX_SIDE } from './render';

const HEIC_TYPES = ['image/heic', 'image/heif'];

export function isHeic(file: File): boolean {
  return HEIC_TYPES.includes(file.type.toLowerCase()) || /\.(heic|heif)$/i.test(file.name);
}

/**
 * Decode the photo as displayed, scaled down so its longest side is at most MAX_SIDE. A 12 MP
 * phone photo would otherwise be too large to upload and too heavy for phone canvases; 2600 px
 * is still more than Muse Spark needs.
 *
 * Re-drawing onto a canvas also drops all metadata (EXIF, GPS position,
 * camera serial), so the uploaded image carries only pixels.
 */
export async function loadImage(file: File): Promise<HTMLCanvasElement> {
  const bitmap = (await decode(file)) ?? (isHeic(file) ? await decodeHeic(file) : null);
  if (!bitmap) throw new Error('This image could not be opened. Try saving it as JPEG or PNG.');

  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = createCanvas(bitmap.width * scale, bitmap.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

function decode(blob: Blob): Promise<ImageBitmap | null> {
  return createImageBitmap(blob, { imageOrientation: 'from-image' }).catch(() => null);
}

/** Safari reads HEIC itself; other browsers get a WebAssembly decoder, loaded only when needed. */
async function decodeHeic(file: File): Promise<ImageBitmap | null> {
  try {
    const { heicTo } = await import('heic-to/csp');
    return await decode(await heicTo({ blob: file, type: 'image/jpeg', quality: 0.95 }));
  } catch {
    return null;
  }
}
