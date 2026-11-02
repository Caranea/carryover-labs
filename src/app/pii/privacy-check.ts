import { LocalDocument, PrivacyMode, WorkingPage } from '../core/models';
import { PagePredictions } from './detect';

/** Whether the automatic check covered every page with text, or the user hides details by hand. */
export function privacyCheck(
  pages: WorkingPage[],
  predictions: PagePredictions[],
  mode: PrivacyMode = 'automatic',
): Pick<LocalDocument, 'privacyCheck'> {
  if (mode === 'lightweight') return { privacyCheck: 'manual' };
  const missed = pages.some(
    (page, i) => page.words.some((w) => w.text !== null) && !predictions[i],
  );
  return { privacyCheck: missed ? 'incomplete' : 'complete' };
}
