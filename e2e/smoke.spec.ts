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
  await page.getByText('Change how we check').click();
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

test('the sample patient is read from recorded answers, with no key, and charted', async ({
  page,
}) => {
  const sent: Record<string, unknown>[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/pages'))
      sent.push(request.postDataJSON() as Record<string, unknown>);
  });
  await page.goto('/documents');
  await page.getByText('Change how we check').click();
  await page.getByRole('radio', { name: /Manual review/ }).check();
  await page.getByRole('button', { name: 'Try the sample patient' }).click();
  const dialog = page.getByRole('dialog', { name: 'Try the sample patient' });
  // Three documents are picked to start with; keep only the English fax.
  await dialog.getByRole('checkbox', { name: /^Kumulativbericht/ }).uncheck();
  await dialog.getByRole('checkbox', { name: /^TSH, FT3, FT4 / }).uncheck();
  await dialog.getByRole('button', { name: 'Add 1 document' }).click();

  const review = page.getByRole('button', { name: /Check and approve/ });
  await expect(review).toBeVisible({ timeout: 60_000 });
  await review.dispatchEvent('click');
  await page.getByRole('button', { name: 'Approve and send' }).dispatchEvent('click');
  await expect(page.getByText('Results are ready.')).toBeVisible({ timeout: 60_000 });

  expect(sent).toHaveLength(1);
  expect(sent[0]['sample']).toBe('jane-doe-039:0');
  await page.goto('/results');
  await expect(page.getByText('Platelets').first()).toBeVisible();
});

test('the demo replays Meta answers for a fictional page without a key', async ({ page }) => {
  await page.goto('/demo');
  await expect(page.getByRole('heading', { level: 1 })).toContainText("Jane's tests");
  await page.getByRole('button', { name: 'Read it', exact: true }).click();
  await expect(page.getByText('named each test')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('app-live-read').getByText('Free T4')).toBeVisible();
});

test('the demo says when no sample answers are on the server', async ({ page }) => {
  await page.route('**/api/config', (route) =>
    route.fulfill({
      json: {
        models: { transcription: 'muse-spark-1.3', identification: 'muse-wonder-1.0' },
        live: false,
        samplePatient: false,
      },
    }),
  );
  await page.goto('/demo');
  await expect(page.getByText("The sample answers aren't on this server.")).toBeVisible();
});
