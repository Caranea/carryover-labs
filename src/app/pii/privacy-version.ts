import { WorkingPage } from '../core/models';

/** Bumped when saved progress from an earlier flow must go back through review. */
export const PRIVACY_VERSION = 5;

export function countHidden(pages: WorkingPage[]): number {
  return pages.reduce((n, p) => n + p.words.filter((w) => w.hidden).length + p.regions.length, 0);
}
