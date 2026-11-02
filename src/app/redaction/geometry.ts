import { Box } from '../core/models';

export function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Normalise a drag gesture (any direction) into a box. */
export function boxFromPoints(x1: number, y1: number, x2: number, y2: number): Box {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  };
}

export function toTuple(box: Box): [number, number, number, number] {
  return [Math.round(box.x), Math.round(box.y), Math.round(box.w), Math.round(box.h)];
}

export function fromTuple(t: [number, number, number, number]): Box {
  return { x: t[0], y: t[1], w: t[2], h: t[3] };
}
