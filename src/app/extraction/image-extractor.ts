import { createCanvas, MAX_SIDE } from './render';

const HEIC_TYPES = ['image/heic', 'image/heif'];

export function isHeic(file: File): boolean {
  return HEIC_TYPES.includes(file.type.toLowerCase()) || /\.(heic|heif)$/i.test(file.name);
}

/**
 * Decode the photo as displayed, without OCR orientation changes, scaled down so its longest
 * side is at most MAX_SIDE. A 12 MP phone photo would otherwise be too large to upload and
 * too heavy for phone canvases; 2600 px is still more than OCR and Muse Spark need.
 *
 * Re-drawing onto a canvas also drops all metadata (EXIF, GPS position,
 * camera serial), so the uploaded image carries only pixels.
 */
export async function loadImage(file: File): Promise<HTMLCanvasElement> {
  let blob: Blob = file;
  if (isHeic(file)) {
    const { default: heic2any } = await import('heic2any');
    const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.95 });
    blob = Array.isArray(converted) ? converted[0] : converted;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This image could not be opened. Try saving it as JPEG or PNG.');
  }

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
