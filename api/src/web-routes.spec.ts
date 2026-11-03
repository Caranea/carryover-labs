import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isAppPage } from './web-routes.js';

describe('app pages', () => {
  it('answers the routes of the Angular app', () => {
    for (const path of ['/', '/documents', '/results', '/review/4f1c-22', '/saved/9a7e-10']) {
      assert.equal(isAppPage(path), true, path);
    }
  });

  it('leaves API paths and missing files to the 404 handler', () => {
    for (const path of ['/api/health', '/chunk-LR3UUZWC.js', '/main-AB12.js', '/styles-AB12.css']) {
      assert.equal(isAppPage(path), false, path);
    }
  });
});
