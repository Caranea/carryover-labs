import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { from, switchMap, tap } from 'rxjs';
import { AuthService } from './auth.service';

/** Adds the Clerk session token to every call to our own API. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api/') || req.url === '/api/config') return next(req);
  const auth = inject(AuthService);
  const owner = auth.userId();
  const revision = auth.sessionRevision();
  const requireSameSession = () => {
    if (!owner || owner !== auth.userId() || revision !== auth.sessionRevision()) {
      throw new HttpErrorResponse({ status: 401, statusText: 'Session changed', error: { message: 'Your signed-in account changed. Open the page again to continue.' } });
    }
  };
  return from(auth.token()).pipe(
    switchMap((token) => {
      requireSameSession();
      if (!token) throw new HttpErrorResponse({ status: 401, statusText: 'Sign-in required' });
      return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })).pipe(tap(() => requireSameSession()));
    }),
  );
};
