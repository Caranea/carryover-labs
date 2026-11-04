import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// Browsers hide what the app needs (crypto.randomUUID, storage, WebGPU) outside a secure context,
// so a visitor who arrives over plain HTTP would get a blank page.
if (window.isSecureContext) {
  bootstrapApplication(App, appConfig).catch((err) => console.error(err));
} else {
  location.replace(location.href.replace(/^http:/, 'https:'));
}
