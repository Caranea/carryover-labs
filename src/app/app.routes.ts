import { Routes } from '@angular/router';
import { withoutAnalyticsGuard } from './core/analytics';
import { resultsReadyGuard } from './core/results-ready.guard';

export const routes: Routes = [
  {
    path: '',
    title: 'Carryover Labs – Home',
    loadComponent: () => import('./landing/home.page').then((m) => m.HomePage),
  },
  {
    path: 'demo',
    data: { demo: true },
    title: 'Sample patient – Carryover',
    loadComponent: () => import('./results/results.page').then((m) => m.ResultsPage),
  },
  {
    path: 'documents',
    title: 'Add documents – Carryover',
    canActivate: [withoutAnalyticsGuard],
    loadComponent: () => import('./upload/upload.page').then((m) => m.UploadPage),
  },
  {
    path: 'review/:localId',
    title: 'Check what is hidden – Carryover',
    canActivate: [withoutAnalyticsGuard],
    loadComponent: () => import('./review/review.page').then((m) => m.ReviewPage),
  },
  {
    path: 'results',
    canActivate: [withoutAnalyticsGuard, resultsReadyGuard],
    title: 'Your results – Carryover',
    loadComponent: () => import('./results/results.page').then((m) => m.ResultsPage),
  },
  {
    path: 'saved/:serverId',
    title: 'Opening document – Carryover',
    canActivate: [withoutAnalyticsGuard],
    loadComponent: () => import('./review/open-saved.page').then((m) => m.OpenSavedPage),
  },
  { path: '**', redirectTo: '' },
];
