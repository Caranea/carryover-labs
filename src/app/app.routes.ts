import { Routes } from '@angular/router';
import { authGuard, signedOutGuard } from './auth/auth.guard';

export const routes: Routes = [
  { path: 'demo', data: { demo: true }, title: 'Fictional sample – Carryover', loadComponent: () => import('./results/results.page').then((m) => m.ResultsPage) },
  { path: 'appointment', canActivate: [(route, state) => route.queryParamMap.get('demo') === 'true' ? true : authGuard(route, state)], title: 'Appointment record – Carryover', loadComponent: () => import('./appointment/appointment.page').then((m) => m.AppointmentPage) },
  {
    path: 'sign-in',
    canActivate: [signedOutGuard],
    title: 'Sign in – Carryover',
    loadComponent: () => import('./auth/sign-in.page').then((m) => m.SignInPage),
  },
  {
    path: '',
    canActivate: [authGuard],
    title: 'Add documents – Carryover',
    loadComponent: () => import('./upload/upload.page').then((m) => m.UploadPage),
  },
  {
    path: 'review/:localId',
    canActivate: [authGuard],
    title: 'Check what is hidden – Carryover',
    loadComponent: () => import('./review/review.page').then((m) => m.ReviewPage),
  },
  {
    path: 'results',
    canActivate: [authGuard],
    title: 'Your results – Carryover',
    loadComponent: () => import('./results/results.page').then((m) => m.ResultsPage),
  },
  {
    path: 'saved/:serverId',
    canActivate: [authGuard],
    title: 'Opening document – Carryover',
    loadComponent: () => import('./review/open-saved.page').then((m) => m.OpenSavedPage),
  },
  { path: '**', redirectTo: '' },
];
