/** Pure pixel geometry shared with the browser; no server or browser dependencies. */
export interface PixelBox { x: number; y: number; w: number; h: number }
export interface MaskWord { hidden: boolean; box?: PixelBox }

export function storedMaskGeometry(page: { width: number; height: number; words: readonly { h?: boolean; b?: readonly [number, number, number, number] }[]; regions: readonly (readonly [number, number, number, number])[] }) {
  const box = (tuple: readonly number[]): PixelBox => ({ x: tuple[0], y: tuple[1], w: tuple[2], h: tuple[3] });
  return maskGeometry(page.width, page.height, page.words.map((word) => ({ hidden: word.h === true, box: word.b ? box(word.b) : undefined })), page.regions.map(box));
}

export function pixelBox(width: number, height: number, box: PixelBox): PixelBox {
  const x = Math.max(0, Math.min(width - 1, Math.round(box.x)));
  const y = Math.max(0, Math.min(height - 1, Math.round(box.y)));
  return { x, y, w: Math.max(1, Math.min(width - x, Math.round(box.w))), h: Math.max(1, Math.min(height - y, Math.round(box.h))) };
}

export function redactionPadding(box: PixelBox): number { return Math.max(2, Math.round(box.h * 0.15)); }

/** Include the former canvas/server +1 right/bottom pixel here, exactly once. */
function footprint(width: number, height: number, box: PixelBox, padding: number): PixelBox {
  const x = Math.max(0, box.x - padding); const y = Math.max(0, box.y - padding);
  return { x, y, w: Math.min(width, box.x + box.w + padding + 1) - x, h: Math.min(height, box.y + box.h + padding + 1) - y };
}
function intersects(a: PixelBox, b: PixelBox) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Real overlaps are removed in full. Padding stops at neighbouring OCR boxes
 * so a safety margin cannot grow into an unrelated row of clinical text.
 * A work queue reaches a fixed point. The grid indexes only remaining words,
 * so long/reversed chains do not require repeated scans of the whole page.
 * Origins refer to the initiating word index, or -(region index + 1), for Undo.
 */
export function maskGeometry(width: number, height: number, words: readonly MaskWord[], regions: readonly PixelBox[]) {
  const boxes: PixelBox[] = [];
  const hidden = new Set<number>();
  const origins = new Map<number, number>();
  const wordBoxes = new Map<number, PixelBox>();
  const regionBoxes = regions.map((box) => footprint(width, height, pixelBox(width, height, box), 0));
  const queue: { box: PixelBox; origin: number }[] = [];
  const remaining = new Set<number>();
  const normalized = words.map((word) => word.box ? pixelBox(width, height, word.box) : undefined);
  const wordFootprint = (index: number): PixelBox => {
    const core = normalized[index]!;
    const padded = footprint(width, height, core, redactionPadding(core));
    let left = padded.x, top = padded.y, right = padded.x + padded.w, bottom = padded.y + padded.h;
    // Use all boxes, independent of their hidden flags, so the browser and the
    // server produce identical geometry from the final manifest too.
    const keys = cells(padded);
    const candidates = keys ? new Set(wideNeighbours) : new Set(normalized.keys());
    if (keys) for (const key of keys) for (const neighbour of neighbours.get(key) ?? []) candidates.add(neighbour);
    for (const neighbour of candidates) {
      const other = normalized[neighbour];
      if (!other || other === core || intersects(core, other) || !intersects(padded, other)) continue;
      if (other.y + other.h <= core.y) top = Math.max(top, other.y + other.h);
      else if (other.y >= core.y + core.h) bottom = Math.min(bottom, other.y);
      else if (other.x + other.w <= core.x) left = Math.max(left, other.x + other.w);
      else if (other.x >= core.x + core.w) right = Math.min(right, other.x);
    }
    return { x: left, y: top, w: right - left, h: bottom - top };
  };
  const buckets = new Map<number, Set<number>>();
  const membership = new Map<number, number[]>();
  const wide = new Set<number>();
  const columns = Math.max(1, Math.ceil(width / 128));

  // Oversized boxes use a bounded fallback instead of allocating thousands of entries.
  const cells = (box: PixelBox): number[] | null => {
    const x1 = Math.floor(box.x / 128); const x2 = Math.floor((box.x + box.w - 1) / 128);
    const y1 = Math.floor(box.y / 128); const y2 = Math.floor((box.y + box.h - 1) / 128);
    if ((x2 - x1 + 1) * (y2 - y1 + 1) > 64) return null;
    const keys: number[] = [];
    for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) keys.push(y * columns + x);
    return keys;
  };
  const neighbours = new Map<number, number[]>();
  const wideNeighbours = new Set<number>();
  normalized.forEach((box, index) => {
    if (!box) return;
    const keys = cells(box);
    if (!keys) { wideNeighbours.add(index); return; }
    for (const key of keys) {
      const list = neighbours.get(key) ?? [];
      list.push(index); neighbours.set(key, list);
    }
  });
  const hide = (index: number, origin: number) => {
    if (hidden.has(index)) return;
    hidden.add(index); origins.set(index, origin); remaining.delete(index); wide.delete(index);
    for (const key of membership.get(index) ?? []) buckets.get(key)?.delete(index);
    const box = normalized[index];
    if (box) {
      const mask = wordFootprint(index);
      wordBoxes.set(index, mask); boxes.push(mask); queue.push({ box: mask, origin });
    }
  };

  words.forEach((word, index) => {
    if (word.hidden) { hide(index, index); return; }
    const box = normalized[index];
    if (!box) return;
    remaining.add(index);
    const keys = cells(box);
    if (!keys) { wide.add(index); return; }
    membership.set(index, keys);
    for (const key of keys) {
      let bucket = buckets.get(key);
      if (!bucket) { bucket = new Set(); buckets.set(key, bucket); }
      bucket.add(index);
    }
  });
  regionBoxes.forEach((box, index) => { boxes.push(box); queue.push({ box, origin: -index - 1 }); });
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const { box, origin } = queue[cursor];
    const keys = cells(box);
    const candidates = keys ? new Set(wide) : remaining;
    if (keys) for (const key of keys) for (const index of buckets.get(key) ?? []) candidates.add(index);
    for (const index of candidates) if (intersects(normalized[index]!, box)) hide(index, origin);
  }
  return { boxes, hidden, origins, wordBoxes, regionBoxes };
}
