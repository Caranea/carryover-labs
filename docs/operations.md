> Historical server-storage evidence: the current demo uses browser localStorage and stateless Meta inference. See [API](api.md) and [privacy](privacy-and-redaction.md) for current behavior. Offline storage tools and legacy tests remain available; their routes are not served by the demo.

# Storage and deployment operations

These are preparation tools and templates. Nothing in this document has been applied to a live service or to personal records. Passing the checks below does not certify compliance, detector accuracy or complete security.

## Storage tool

Build the API, then run `npm --prefix api run storage -- --help`. The tool reads only the explicitly supplied store and environment; it does not load `api/.env`. Output contains counts and issue codes, not medical content, document titles, keys, account IDs or private paths. Exit code `2` means verification failed or an operation was refused. Keep its output restricted anyway: aggregate counts can be sensitive.

| Command | Purpose | Writes |
| --- | --- | --- |
| `inventory --source PATH` | Inspect manifests, JPEG pixels, results, correction/recovery ledgers and current account caches | None |
| `verify --source PATH` | Same complete structural/decryption check, suitable after backup transfer | None |
| `copy-encrypt --source PATH --destination NEW_PATH` | Plan a verified encryption or rotation copy | None by default |
| `copy-encrypt ... --apply --writers-stopped` | Copy into a new encrypted destination, then verify it and recheck the immutable source | New destination only |
| `compare --source PATH --destination PATH` | Compare every logical payload and directory across two valid copies, regardless of encryption nonce/key | None |
| `readiness --source PATH` | Check production key, auth configuration, HTTPS allowed origins, loopback gateway settings and fully encrypted inventory | None |

Keys are supplied by the operator's secret-management environment, never CLI arguments:

- `STORAGE_SOURCE_KEY`: base64-encoded 32-byte key for an encrypted source; unset for historical plaintext.
- `STORAGE_TARGET_KEY`: a separately generated 32-byte key for a new encrypted copy. Supply the destination's existing key for `compare`.
- `readiness` uses the intended runtime `STORAGE_ENCRYPTION_KEY` plus the ordinary app configuration. It does not confirm that a gateway is actually serving TLS or that the credentials are valid at the provider.

Never print a real key, paste it into a command, commit it, store it beside the files it encrypts, or include it in the storage backup. Use the deployment secret manager and a separate restricted recovery copy. Keep the old key until every old backup and retained copy has reached its approved expiry. Merely replacing the runtime key makes older encrypted files unreadable.

## Encrypt historical data or rotate a key

1. Arrange a maintenance window. Stop the API and all background writers. The `--writers-stopped` flag is your assertion, not process detection; the tool cannot stop another host. Keep them stopped until verification and cutover are complete.
2. Take a restricted snapshot of the original directory. Supply the source key if required and run `inventory`. Review every issue; the tool never repairs or deletes source files.
3. Supply a new target key and choose a new sibling directory on protected storage. Run `copy-encrypt` without `--apply` first. Existing destinations and destinations nested inside the source are refused.
4. Run the same command with `--apply --writers-stopped`. Every payload is decoded and encrypted with its original authenticated account/file context. Images are validated but not re-encoded, so source evidence and correction history are preserved byte-for-byte after decryption. The tool synchronizes output files, verifies the new store, rechecks source bytes, and only then publishes the new destination.
5. Run `compare` with the source and destination keys. Run `verify` against the destination using its key as `STORAGE_SOURCE_KEY`. Confirm zero plaintext payloads and no issues. Generation markers contain opaque random identifiers and remain unencrypted.
6. In a separate authorized deployment step, update the runtime storage path and matching key together, start exactly one API writer, then test sign-in, account isolation, a fictional document, source view, correction and deletion. Retain the untouched source and its key for the approved rollback window.

If the process is interrupted, the original remains unchanged. A new `.carryover-migration-*` sibling directory may remain; treat it as sensitive encrypted output, not a completed backup. Inventory the intended source again and investigate the staging directory under restricted access. Do not merge it into a live store or silently remove a source.

## Inventory issues and deliberate limits

- `interrupted-document-swap`: `.old-*` or `.tmp-*` directories exist. Inspect a protected clone and use the application's documented startup recovery there before comparing evidence. The offline tool will not choose a version or discard one.
- `interrupted-extra-write`, `interrupted-or-unknown-cache-file`: incomplete temporary writes need operator review.
- `legacy-shared-cache-needs-review`: `_shared` has no reliable account attribution. Keep it out of the new serving store. Resolve ownership and retention with the data owner; never import it into an arbitrary account or delete it automatically.
- `stale-cache-generation`: a cache generation other than `current` remains. It can contain information since removed from a document. Review retention before explicitly excluding it on a separately prepared source copy.
- `document-verification-failed` or `cache-verification-failed`: possible wrong key, corruption, unsupported structure, stale extractor output, missing image or mismatched source history. No contents are printed. Diagnose using a restricted copy. Do not “fix” a wrong key by falling back to plaintext.
- `unfinished-recovery-job`: a source-recovery job was still marked working. Finish or explicitly resolve it on a protected working copy before preparing the offline source; the scanner will not rewrite its state.
- Unknown files, symbolic links/reparse points, unexpected directories and files larger than 32 MiB are rejected. Large or historical formats require an explicit migration extension and tests, not a bypass.
- A recovery ledger must reference the unchanged source, verified source-word evidence and completed jobs. In-progress jobs must finish or be resolved before an export. Stale correction hashes and old extractor caches block verification rather than being silently dropped.

The scanner accepts validated plaintext so it can migrate historical stores. Inventory success alone does not mean the store is encrypted; check `plaintextPayloads`. The deployment readiness command requires zero plaintext payloads.

## Backup and restore rehearsal

Use offline consistent snapshots: stop writers, verify, then copy to a new encrypted backup using `copy-encrypt`. Keep storage backups, runtime secrets and key-recovery material under separate access controls. Transfer the encrypted directory as binary files without altering names, and run `verify` after transfer.

Rehearse restore into a new isolated directory with `copy-encrypt`, using the backup's key as source and the intended restore key as target. `compare` must succeed before any runtime switch. Start an isolated instance against the restored clone and exercise a fictional source, correction history, page image and account cache. Record the restore duration and outcome without medical data. Synthetic automated tests cover plaintext migration, key rotation, restore comparison, wrong keys, corrupted image payloads, crash/stale/shared inventory and secret-free reports; they do not prove a particular cloud backup service works.

## Single-instance HTTPS deployment template

Review [nginx.conf.example](../ops/nginx.conf.example) and [carryover.service.example](../ops/carryover.service.example) for a Linux host with one local API writer. They are examples, not installed configuration. Replace placeholder domain, certificate and installation paths. Test the gateway configuration on the destination host before enabling it.

The API defaults to `HOST=127.0.0.1`. Set `TRUST_LOOPBACK_PROXY=true` only for the local gateway. It overwrites forwarding headers, exposes only HTTPS publicly, disables API caching and request/response buffering, and applies connection/request limits. A firewall must keep the API port private. This template does not cover a remote proxy, multiple API replicas, containers with published ports or shared-network filesystems. Those require a separate architecture review. Buffering and rate behavior follow the [NGINX proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) and [request-limit module](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html).

The service example uses a dedicated unprivileged account, restrictive file permissions, a separate runtime secret file and a memory ceiling. Confirm those limits with realistic concurrent page decoding on the actual host. Do not add PM2 cluster workers, multiple systemd instances or horizontal replicas against this store; locks are process-local.

## Access, retention and logs

Before real records, the operator must record decisions for each item below. This repository does not choose a legal basis or jurisdiction-specific retention policy.

| Control | Deployment decision and verification |
| --- | --- |
| Runtime secrets | Restricted secret manager injection, key recovery owner, access review and rotation rehearsal |
| Admin access | Named accounts, MFA, least privilege, approved support access and audit process without record content |
| Records | User-visible storage duration, account deletion process, deletion verification and incident contact |
| Backups | Encrypted destination, approved maximum age, expiry schedule, restore rehearsal and deletion ledger replay before serving a restore |
| Model providers | Current processing/retention terms, approved endpoints, training restrictions, region and incident handling |
| Logs | No bodies, page text, correction notes, prompts, bearer tokens or document titles; no debug tracing/core dumps; restricted error-log access and approved expiry |
| Monitoring | Aggregate availability, failures, request counts and capacity; avoid per-patient dashboards or query-string logging |
| Browser/device | Shared-device sign-out guidance, exported-PDF handling, real budget-phone and assistive-technology tests |

Deletion removes the serving document and invalidates derived account knowledge; it does not erase an offline backup, exported PDF or request already sent to an inference provider. Document the maximum backup lifetime and how deletion requests are reapplied before a restoration becomes available. Do not promise immediate deletion from every historical copy.

## Release check record

Run both test suites and production builds from the intended revision. Run `readiness` against a protected intended deployment copy, then separately verify: real HTTPS and redirect behavior; no public API port; no caching of authenticated responses; account isolation; key-loss/wrong-key behavior; backup restore; deletion and retention; bounded requests; provider settings; physical-phone camera and memory; screen-reader and keyboard use; multilingual extraction quality. Record date, revision, owner, evidence and unresolved items. No command here authorizes deployment or provides a compliance/security certification.

## Legacy mask consistency

Inventory and copy verification now check text against the full padded mask closure. An older manifest that kept a neighbouring word's text while its pixels were covered is reported as invalid; it is not silently rewritten or published to the destination. Keep the source immutable, investigate with the application version that wrote it and prepare an explicitly reviewed repair or re-import from the owner's original. Never bypass this check to turn a failed migration into a successful one. Normal saved documents whose visible text lies outside the final masks remain readable without automatic rewriting.

