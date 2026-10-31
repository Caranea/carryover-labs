import { Routes } from '@angular/router';
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
    title: 'Fictional sample – Carryover',
    loadComponent: () => import('./results/results.page').then((m) => m.ResultsPage),
  },
  {
    path: 'appointment',
    canActivate: [resultsReadyGuard],
    title: 'Appointment record – Carryover',
    loadComponent: () => import('./appointment/appointment.page').then((m) => m.AppointmentPage),
  },
  {
    path: 'documents',
    title: 'Add documents – Carryover',
    loadComponent: () => import('./upload/upload.page').then((m) => m.UploadPage),
  },
  {
    path: 'review/:localId',
    title: 'Check what is hidden – Carryover',
    loadComponent: () => import('./review/review.page').then((m) => m.ReviewPage),
  },
  {
    path: 'results',
    canActivate: [resultsReadyGuard],
    title: 'Your results – Carryover',
    loadComponent: () => import('./results/results.page').then((m) => m.ResultsPage),
  },
  {
    path: 'saved/:serverId',
    title: 'Opening document – Carryover',
    loadComponent: () => import('./review/open-saved.page').then((m) => m.OpenSavedPage),
  },
  { path: '**', redirectTo: '' },
];
