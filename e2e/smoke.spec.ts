import { expect, test, type Page } from '@playwright/test';

/** A fictional phone photo whose identifiers are already blacked out. */
const PHOTO = 'public/samples/live/german-cumulative.jpg';

/** Stand in for the batch API: accept every page and never finish, recording what was sent. */
async function stubBatches(page: Page) {
  const sent: Record<string, unknown>[] = [];
  await page.route('**/api/batches/**', async (route) => {
    const request = route.request();
    if (request.method() === 'POST' && request.url().endsWith('/pages')) {
      sent.push(request.postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 202, json: { state: 'queued' } });
    } else if (request.method() === 'GET') {
      await route.fulfill({
        json: { version: 1, pages: [], normalization: { state: 'idle' } },
      });
    } else {
      await route.fulfill({ status: 204 });
    }
  });
  return sent;
}

test('a photo is read on the device, checked by hand and sent only as an approved image', async ({
  page,
}) => {
  const sent = await stubBatches(page);
  await page.goto('/documents');
  // Manual review: the large privacy model isn't downloaded in a smoke test.
  await page.getByRole('radio', { name: /Manual review/ }).check();
  await page.locator('input[type=file]').first().setInputFiles(PHOTO);

  const review = page.getByRole('button', { name: /Check and approve/ });
  await expect(review).toBeVisible({ timeout: 60_000 });
  await review.dispatchEvent('click');
  await page.getByRole('button', { name: 'Approve and send' }).dispatchEvent('click');

  await expect.poll(() => sent.length, { timeout: 30_000 }).toBeGreaterThan(0);
  const body = sent[0];
  // Only the approved page image and its ids leave the device: no file name, OCR or manifest.
  expect(Object.keys(body).sort()).toEqual(['documentId', 'image', 'page', 'pageId', 'revision']);
  expect(JSON.stringify(body)).not.toContain('german-cumulative');
  expect(String(body['image'])).toMatch(/^data:image\/jpeg;base64,/);
  expect(String(body['image']).length).toBeLessThan(20_000_000);
});

test('the fictional sample opens without an account and says when live reading is off', async ({
  page,
}) => {
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { modelName: null, models: null } }),
  );
  await page.goto('/demo');
  await expect(page.getByRole('heading', { level: 1 })).toContainText("Jane's tests");
  await expect(page.getByText("Live reading isn't switched on for this server.")).toBeVisible();
});
