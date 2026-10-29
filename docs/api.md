# API

NestJS/Express, ES modules. All routes are under `/api`. Authenticated document routes verify the Clerk session and derive ownership from its subject; inaccessible document IDs return 404.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/config` | Public Clerk key and storageProtection status |
| GET | `/health` | Public health response |
| GET, POST | `/documents` | List or upload an approved redacted document |
| GET, PUT, DELETE | `/documents/:id` | Read, hide more, or remove an owned document |
| GET | `/documents/:id/pages/:index` | Redacted JPEG |
| GET | `/results` | Source observations, original/corrected fields and document issues |
| PATCH | `/results/:documentId/observations/:observationId` | Checked correction with expectedRevision |
| GET | `/records` | Grouped charts, unresolved rows and model status |
| POST | `/records/retry` | Explicitly retry unfinished model checks |
| GET | `/recovery/:documentId` | Recovery status/proposals; never starts inference |
| POST | `/recovery/:documentId` | Explicit selected-page recovery with page and expectedRevision |
| POST | `/recovery/:documentId/proposals/:proposalId/accept` | Confirm verified evidence with expectedRevision and a source-check note |
| POST | `/recovery/:documentId/proposals/:proposalId/reject` | Dismiss a proposal with expectedRevision |

All except config/health require authentication. See [corrections](extraction.md) and [records](records.md).

## Upload boundary

Multipart fields are a JSON `manifest` plus `pages` named `page-<index>.jpg`. Types in `src/app/core/models.ts` mirror `api/src/documents/contract.ts`.

The server rebuilds known manifest fields, rejects hidden text, checks boxes/regions, scans visible text for a checksum-valid PESEL, and decodes actual JPEGs with dimension/pixel limits. It reapplies declared masks and re-encodes without metadata. Re-redaction preserves the existing saved source pixels and only adds masking; it cannot swap in a different page or restore removed content.

Defaults: 40 pages, 20,000 words per page, 500 regions per page, 8 MiB per image, 6 MiB manifest, 40 MiB aggregate image upload, 25 million pixels per image. Account storage defaults to 500 documents / 512 MiB, including derived writes. HTTP request budgets are 240 reads / 30 writes per minute per observed IP, with four concurrent uploads. These are process-local protections; deployment gateways need their own limits.

Validation returns readable 400/413/422 errors, stale corrections 409, rate limits 429 and unavailable capacity 503. API responses carry private/no-store headers.

## Storage

```
STORAGE_DIR/<sha256 account ID, 40 hex>/
  <document UUID>/
    document.json
    page-0.jpg
    results.json
    corrections.json
    review.json
    recovery.json
  _knowledge/
    current
    <generation>/knowledge.json
```

Payload filenames do not imply plaintext: with a key configured, all payloads use the authenticated encryption envelope. Writes use temporary files/directories and swaps, with account-scoped locks and recovery handling. Run a single API process against this store. Existing plaintext can be read and explicitly migrated; see [privacy](privacy-and-redaction.md).

## Configuration

Copy `api/.env.example` to `api/.env`; never commit credentials.

| Variable | Purpose |
| --- | --- |
| `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Account sign-in/session verification |
| `CLERK_JWT_KEY` | Optional networkless verification key |
| `CLERK_AUTHORIZED_PARTIES` | Allowed frontend origins |
| `STORAGE_DIR` | File store, default `./storage` relative to api |
| `STORAGE_ENCRYPTION_KEY` | Base64-encoded 32-byte key; required when NODE_ENV=production |
| `PORT`, `WEB_ROOT` | API port and built frontend directory |
| `HOST`, `TRUST_LOOPBACK_PROXY` | Defaults to private loopback binding; opt-in forwarding trust only for a local gateway |
| `BASETEN_API_KEY`, `BASETEN_BASE_URL`, `BASETEN_MODEL` | Primary Meta open-weight inference |
| `META_MODEL_API_KEY`, `META_MODEL_BASE_URL`, `META_MODEL` | Meta Model API fallback |

Security headers include no-sniff, no-referrer, frame denial, same-origin resource policy and a restricted permissions policy. HTTPS requests receive HSTS. HTTPS termination, trusted proxy settings, CSP, operational logging/retention and secrets custody need deployment review.

