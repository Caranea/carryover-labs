# Development

## Requirements

- Node 24.15 or newer in the Node 24 LTS line for the installed tooling.
- A Clerk application (free tier is enough): https://dashboard.clerk.com

## First setup (Windows PowerShell)

```powershell
npm install
npm --prefix api install
copy api\.env.example api\.env
# paste CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY into api\.env
```

## Running

Two terminals:

```powershell
npm run start:api     # NestJS on http://localhost:3000 (watch mode)
npm start             # Angular on http://localhost:4200, proxies /api → :3000 (proxy.conf.json)
```

Open http://localhost:4200. Choose the recommended full local check or lightweight review before adding files. The full check downloads the personal-detail model (~280 MB, cached); lightweight review skips that download and requires manual review acknowledgement. Both keep detection on the device.

## Styling

Tailwind CSS 4 runs through PostCSS (`.postcssrc.json`), and daisyUI 5 is a Tailwind plugin configured
in `src/styles.css`. Restart `npm start` after changing `.postcssrc.json`. See
[frontend.md](frontend.md#design-system-daisyui) for the theme and components.

## Tests

```powershell
npm test -- --watch=false   # Angular unit tests (Vitest, jsdom)
npm --prefix api test       # API tests (TypeScript build + node:test)
```

| Suite | What it proves |
| --- | --- |
| `pii/rules.spec.ts` | PESEL and dates; PL/DE/EN labels; stopping at next field and column gaps; titles; addresses, postcodes, phones, e-mails; result rows never hidden; strict expansion; model label mapping; thresholds; propagation; locked words; file name cleaning incl. declined forms |
| `extraction/layout.spec.ts` | Word boxes from PDF runs, line grouping |
| `redaction/burn.spec.ts` | Hidden text never in the upload; detection details stripped; drawn boxes hide words underneath; padding |
| `pii/ner-sequences.spec.ts` | Token spans map to the right words; sequence splitting; per-word aggregation |
| `api/.../validate.spec.ts` | Manifest rebuilt from known fields; hidden-with-text rejected; PESEL (whole and split) found, lab values ignored; only-more-hidden rule |
| `api/.../api.spec.ts` | Real HTTP: public config, 401s, create/list/get/page/replace/delete, per-user isolation, PESEL 422, non-JPEG 400 |

The API test script compiles to `.test-build/` and runs `node --test`. Vitest is not used in `api/`
because it failed to install alongside the Nest CLI (npm `edgesOut` error).

## Scripts

| Script | Where | Does |
| --- | --- | --- |
| `npm start` | root | `ng serve` with the API proxy |
| `npm run build` | root | Production build to `dist/carryover-labs/browser` |
| `npm run start:api` | root | Runs `api`'s `start:dev` |
| `npm run build` | api | `nest build` to `api/dist` |
| `npm start` | api | `node dist/main.js` (serves the built app too, if present) |
| `npm run storage -- --help` | api | Offline inventory/verification, dry-run migration and encrypted copy/rotation; see [operations.md](operations.md) |

## Test documents

Never commit real documents. Put your own files in `private-test-data/` (git-ignored). For demos,
use made-up documents with fake names and a fake but checksum-valid PESEL (for example `44051401359`).

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Sign-in page shows the intro but no sign-in box | Clerk's npm package has no UI; the UI script is loaded from Clerk's CDN | Check the error notice on the page and the browser console; make sure Clerk's domain isn't blocked by an extension |
| "Sign-in is not available right now… CLERK_PUBLISHABLE_KEY is not set" | Missing `api/.env` or API not running | Create `.env`, start `npm run start:api` |
| 401 on every API call | Secret key from a different Clerk app, or the origin isn't in `CLERK_AUTHORIZED_PARTIES` | Check both in `api/.env` |
| Yellow "only built-in patterns are used" notice | Model couldn't download or start | Check network access to huggingface.co; reload. Rules still work |
| OCR stuck at 0% | OCR assets not served | Run through `npm start` (assets are copied by the Angular build), not by opening files directly |
| "A PESEL number still seems to be visible" when saving | Server safety check | Hide that number on the indicated page and save again |
| Reloading lost my files | By design: originals never leave the tab | Add the files again |

## Building for production

```powershell
npm run build
npm --prefix api run build
npm --prefix api start      # serves the API and the app from one origin on PORT
```

Set `CLERK_AUTHORIZED_PARTIES` to the production origin and use Clerk production keys.

## Current release checks

CI runs both synthetic test suites, production builds, the positioned-text benchmark and isolated HTTP/PDF integration. After the API build, `npm run benchmark` and `npm run check:flow` reproduce the latter checks locally. Add `-- --ocr` to both commands, in that order, to recognize actual generated images first. See [benchmark.md](benchmark.md) for measured outcomes and caveats, [synthetic-recovery-check.md](synthetic-recovery-check.md) for opt-in live inference, and [demo-script.md](demo-script.md) for the current recording plan. Deployment requires an external storage key and verified migration of any historical plaintext.

