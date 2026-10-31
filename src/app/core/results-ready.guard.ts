import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { DocumentQueueService } from './document-queue.service';

/** No partial results while a file is still being prepared, reviewed or saved. */
export const resultsReadyGuard: CanActivateFn = async () => {
  const queue = inject(DocumentQueueService);
  const router = inject(Router);
  // Another tab owns the queue: the Documents page says so instead of waiting here.
  await Promise.race([queue.ready, queue.recovery.blocked]);
  if (queue.recovery.otherTab()) return router.createUrlTree(['/documents']);
  if (!queue.resultsBlocked()) return true;
  queue.openReview();
  return router.createUrlTree(['/documents']);
};
