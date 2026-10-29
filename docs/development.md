# Development

Use Node 24.15 or newer in the Node 24 LTS line.

## Setup

```powershell
npm ci
npm --prefix api ci
# Only when api/.env does not already exist:
Copy-Item api/.env.example api/.env
# Add BASETEN_API_KEY and/or META_MODEL_API_KEY.
npm run start:api
# In a second terminal:
npm start
```

Open `http://localhost:4200`. Home links to Documents at `/documents`, Results at `/results`, and the fictional prepared sample at `/demo`. No account setup is needed.

The optional full personal-detail check downloads a browser model on first use. Lightweight review skips that download and requires manual review acknowledgement. Original files remain in tab memory; approved copies and previous results persist in localStorage. Clearing site data removes them. Large photos can exhaust localStorage: a failed save preserves the existing history.

## Verify

```powershell
npm test -- --watch=false
npm --prefix api test
npm run build
npm --prefix api run build
npm run benchmark
```

Browser tests cover persistence, quota rollback, source redaction, corrections, recovery confirmation, stale AI responses and view lifecycles. API tests exercise the stateless endpoints with synthetic model responses and verify that legacy stored-document routes return 404. Older storage regressions remain isolated in `StorageTestModule`; they do not mount routes in the production application.

`npm run check:flow` exercises the retained legacy storage harness with synthetic inputs and no paid calls. It is not the browser-local demo flow. Live inference is a separate check using fictional text.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| AI unavailable | Start the API and configure a Meta/Baseten key, then retry matching |
| Browser storage full | Remove an older demo document or add fewer/smaller pages; previous saved results remain intact |
| History absent | Use the same browser profile and site origin; unsaved originals disappear on refresh |
| Local detail model unavailable | Use lightweight review and manually check all pages |
| OCR cannot load assets | Run through the app server, not by opening HTML directly |

## Build and serve

```powershell
npm run build
npm --prefix api run build
npm --prefix api start
```

The API serves the built app on the same origin when the output folder is present. Keep inference keys server-side and use HTTPS for a hosted demo.

