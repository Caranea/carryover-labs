import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (await auth.isSignedIn()) return true;
  return auth.status() === 'error' ? router.parseUrl('/sign-in?problem=1') : router.parseUrl('/sign-in');
};

export const signedOutGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return (await auth.isSignedIn()) ? router.parseUrl('/') : true;
};
