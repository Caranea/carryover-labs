import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { DocumentQueueService } from './document-queue.service';

/** No partial results while a file is still being prepared, reviewed or saved. */
export const resultsReadyGuard: CanActivateFn = async () => {
  const queue = inject(DocumentQueueService);
  const router = inject(Router);
  await queue.ready;
  if (!queue.resultsBlocked()) return true;
  queue.openReview();
  return router.createUrlTree(['/documents']);
};
