# M2-2 Remediation Report — Media Object Storage Runtime Integration

**Sprint:** Medium Findings Remediation — M2-2 only.
**Baseline:** `HEAD` `b10f7fc` (M2-3, previous sprint in this series).
**Source finding:** `FINAL_PRODUCTION_READINESS_AUDIT_v2.md`, re-verified unchanged in `MEDIUM_VERIFICATION_REPORT.md`, scoped in `MEDIUM_REMEDIATION_PLAN.md` §2 ("Media object storage is a stub that reports every object as existing").

---

## Investigation

**Storage abstraction (`ObjectStoragePort`, `services/media/src/application/object-storage.port.ts`):**
two methods — `exists(storageKey): Promise<boolean>` and `getDownloadUrl(storageKey): Promise<string>`.
Two implementations existed in `services/media/src/infrastructure/object-storage-adapters.ts`:

- `InMemoryObjectStorage` — `exists()` always returns `true`; `getDownloadUrl()` returns
  `https://storage.local/${storageKey}`, a template that has never pointed at real storage.
- `StorageServiceObjectStorage` — both methods **unconditionally threw** `"...not wired in this
environment yet"`. Never constructed anywhere in the codebase (confirmed by direct search: zero
  references outside its own file and the audit/plan docs).

**Dependency injection / current provider:** `MediaLibraryWiringDeps.objectStorage?: ObjectStoragePort`
(`services/media/src/media-library.composition.ts:43`) — the seam already existed, confirmed by
`buildController`'s `deps.objectStorage ?? new InMemoryObjectStorage()` (line 73). This is the one
difference from M2-3 (Licensing), which had zero seam at all.

**Production wiring:** `apps/admin/src/composition.ts:341` calls `wireMediaLibrary(deps)`, passing
`AdminWiringDeps` straight through (same pass-through convention as every other wired context) — but
`AdminWiringDeps` had **no `objectStorage` field at all**, so nothing could ever reach the seam from
outside `services/media` itself. `apps/runtime/src/api.ts` (`startApi`, the actual process boot path)
never referenced object storage in any way, and neither `apps/runtime/src/config.ts`
(`RuntimeConfig`) nor `apps/runtime/src/composition.ts` (`buildRuntimeCore`) had ever parsed an
`S3_*` environment variable or constructed an S3 client — confirmed by a repo-wide search: zero
importers of `@platform/storage` anywhere under `apps/`.

**Local wiring:** identical gap — no `apps/` entrypoint ever imported `@platform/storage`, so `local`
also always fell back to `InMemoryObjectStorage`.

**MinIO/S3 compatibility, upload flow, download flow, signed URL generation:** all already fully
built and unused. `packages/storage` (Sprint 0.2) ships two complete, independent S3-compatible
implementations against `@aws-sdk/client-s3`:

- `S3ObjectStorage` (`packages/storage/src/s3-object-storage.ts`) — full put/get/head/delete/
  multipart/signed-URL surface, already covered by its own honestly-gated integration suite
  (`s3-object-storage.integration.test.ts`).
- `S3StorageService` (`packages/storage/src/storage.ts`), reached via `createStorage()`/
  `StorageHandle.bucket(name)` — the narrower, signed-URL-only surface (`getSignedUploadUrl`,
  `getSignedDownloadUrl`, `objectExists`, `ensureBucket`) that matches `ObjectStoragePort`'s two
  methods almost exactly. **This is the class `StorageServiceObjectStorage`'s name refers to** and
  the one this fix wires in.

**Bucket provisioning:** already handled entirely outside application code —
`infrastructure/docker/docker-compose.yml`'s `createbuckets` one-shot `mc` container creates
`media`/`exports`/`imports`/`backups` on the `minio` service before anything else starts. No
application-level provisioning was missing or added.

**Startup validation:** none existed for object storage — `apps/runtime`'s `RuntimeConfig` zod
schema had no `S3_*` fields, so there was no way for the process to even know it should have real
storage configured, let alone refuse to boot without it.

## Root Cause

Two independent gaps, both required to close M2-2:

1. **`StorageServiceObjectStorage` was a permanently-throwing placeholder**, not a real adapter —
   even if something had constructed and injected it, every call would throw immediately.
2. **The seam was never wired end to end.** `MediaLibraryWiringDeps.objectStorage?` existed, but
   `AdminWiringDeps` (the layer that actually receives runtime-supplied dependencies) had no matching
   field, and `apps/runtime` never parsed S3 config or constructed an S3 client to supply one with in
   the first place. The "zero importers" state the audit cited was accurate at every layer.

Net effect: every `RegisterMediaAsset.execute()` (`services/media/src/application/media-library.use-cases.ts:116`)
accepted any `storageKey` as valid regardless of whether an object was ever uploaded, and every
`GetDownloadUrl.execute()` (line 200) returned a URL that had never been signed and does not resolve
against real storage — in every environment, including production.

## Runtime Evidence

**Reproduced pre-fix, in the new test file** (`services/media/src/infrastructure/object-storage-adapters.test.ts`,
run against the adapter as it existed before this change): calling `StorageServiceObjectStorage`'s
`exists()`/`getDownloadUrl()` threw `"StorageServiceObjectStorage is not wired in this environment
yet"` unconditionally — proving there was no working real-adapter code path, only a placeholder that
could never have backed production traffic even if it had been wired.

**Live MinIO verification — attempted, not available in this sandbox, disclosed rather than faked.**
Per this repo's own established convention (`packages/storage/src/s3-object-storage.integration.test.ts`'s
"HONESTLY GATED... never faked" pattern, reused verbatim here), I wrote a second honestly-gated
integration suite, `packages/storage/src/storage.integration.test.ts`, covering exactly the surface
`StorageServiceObjectStorage` uses in production against real MinIO: bucket existence (`ensureBucket`),
`objectExists` reporting `false` before upload, a real `PUT` through the signed upload URL followed by
`objectExists` flipping to `true`, a real `GET` through the signed download URL round-tripping the
uploaded bytes and preserving `Content-Type`, and a bounded-expiry check on the signed URL
(`X-Amz-Expires=60`). This suite (and the pre-existing sibling one) both run automatically —
`describe.runIf(enabled)` — whenever `STORAGE_TEST_BUCKET`/`S3_ENDPOINT`/`AWS_ACCESS_KEY_ID`/
`AWS_SECRET_ACCESS_KEY` are set, and are silently, honestly skipped otherwise.

In this sandbox: `docker version` succeeded (client present), but `docker ps`/`docker info` failed —
`failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine ... The system
cannot find the file specified`. I launched Docker Desktop and waited over 10 minutes; the daemon
never came up (`wsl -l -v` showed its `docker-desktop` WSL VM stuck `Stopped`), consistent with a
prior session's independently-confirmed finding that Docker Desktop is broken in this sandbox
([[lumo-integration-verification-sprint]] memory). **Both integration suites therefore ran and
reported `skipped`, not `passed`** — `pnpm test` output: `@platform/storage:test: Test Files 2
passed | 2 skipped (4)`. This is disclosed here exactly as instructed ("do not fake runtime
verification") rather than presented as a pass.

**What was verified for real in this sandbox:** the full delegation logic, against a fake
`StorageService` that behaves exactly like the real one's public contract (`object-storage-adapters.test.ts`,
3 tests) — `exists()`/`getDownloadUrl()` now call through to `objectExists()`/`getSignedDownloadUrl()`
with the given key and return their real results, not a hardcoded `true`/template.

## Code Changes

Reuses `@platform/storage`'s already-complete `S3StorageService`/`createS3Client` and Media's already
-existing `deps.objectStorage` seam; introduces no new storage abstraction.

1. **`services/media/src/infrastructure/object-storage-adapters.ts`** — `StorageServiceObjectStorage`
   now takes a `StorageService` (constructor injection) and delegates `exists`→`objectExists`,
   `getDownloadUrl`→`getSignedDownloadUrl`, instead of throwing.
2. **`services/media/src/index.ts`** — exported `InMemoryObjectStorage`/`StorageServiceObjectStorage`
   (previously internal) so `apps/runtime` can construct the real one and the boot guard can identify
   the stub by type.
3. **`services/media/package.json`** — added `@platform/storage` as a dependency (first consumer).
4. **`packages/storage/src/client.ts`** — narrowed `createS3Client`'s parameter from the full
   `StorageConfig` (which includes an unrelated 3-bucket registry) to `Pick<StorageConfig, "endpoint"
| "region" | "forcePathStyle" | "accessKeyId" | "secretAccessKey">` — the fields it actually reads.
   Purely a signature relaxation (every existing caller passing a full `StorageConfig` still
   satisfies it); lets `apps/runtime` build a client without fabricating unused `exports`/`backups`
   bucket names it has no reason to know about.
5. **`apps/admin/src/composition.ts`** — added optional `objectStorage?: ObjectStoragePort` to
   `AdminWiringDeps`, passed straight through to `wireMediaLibrary(deps)` (already flows via the
   existing pass-through at line 341, same mechanism as `payments`/`financeLedger` in M2-3).
6. **`apps/runtime/src/config.ts`** — added `S3_ENDPOINT`/`S3_REGION`/`S3_ACCESS_KEY_ID`/
   `S3_SECRET_ACCESS_KEY`/`S3_FORCE_PATH_STYLE`/`S3_BUCKET_MEDIA` (same field names as
   `@platform/config/server`'s existing schema), all optional so the graph stays buildable without
   Docker in `local`/tests.
7. **`apps/runtime/src/composition.ts`** — `RuntimeCore` gained `objectStorage: ObjectStoragePort`;
   `buildRuntimeCore` resolves the real `StorageServiceObjectStorage` (wrapping `S3StorageService`
   scoped to `S3_BUCKET_MEDIA`) once `S3_ENDPOINT`+credentials are present, else
   `InMemoryObjectStorage` — unchanged default. Construction is side-effect-free (no network call),
   matching this composition root's existing "lazy clients" discipline.
8. **`apps/runtime/package.json`** — added `@platform/media` and `@platform/storage`.
9. **`apps/runtime/src/api.ts`** — added `assertProductionObjectStorageConfigured(appEnv,
objectStorage)`, extracted the same way as the M2-3/V-1 guards but **adapter-identity-based**
   (`objectStorage instanceof InMemoryObjectStorage`) rather than `appEnv`-only, per the plan's exact
   phrasing ("fail closed at boot outside local if the resolved adapter is still
   `InMemoryObjectStorage`") — because, unlike those two, a real code path now exists here and the
   guard must distinguish "configured" from "not," not assume "never." Called from `startApi`
   alongside the MFA/PaymentProvider/Licensing guards; the resolved `runtime.objectStorage` is also
   now passed into `createAdminHttpApi`.
10. **New tests:** `services/media/src/infrastructure/object-storage-adapters.test.ts` (3 cases —
    real delegation, unchanged in-memory fallback), `packages/storage/src/storage.integration.test.ts`
    (honestly-gated live-MinIO suite, see above), 5 new cases in
    `apps/runtime/src/composition.test.ts` (2 proving `buildRuntimeCore` resolves the correct adapter
    by config presence, 3 for the new guard's throw/warn/pass-through behavior).

No existing use case, controller, event, or public API signature changed. No new bounded context.
No Media redesign — `ObjectStoragePort`'s two methods are untouched.

## Production Impact

**Before:** in any environment, including production, every media asset's existence check always
passed and every download URL was an unsigned template that has never resolved against real storage
— broken images and dead download links the moment Media's already-durable Postgres asset rows were
browsed anywhere real, silently (no error, no signal). **After:** the process now refuses to boot
outside `APP_ENV=local` while object storage is still backed by the in-memory stub, converting a
silent customer/admin-visible correctness gap into a loud boot-time failure — the same disposition
already applied to MFA (C2-4), PaymentProvider webhooks (V-1), and Licensing billing (M2-3). Once
`S3_ENDPOINT`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` are set (already documented in `.env.example`
for the MinIO compose stack), Media's existence checks and download URLs are real: a real `HeadObject`
and a real time-bounded signed `GetObject` URL.

## Regression Risk

**Low.** Every new field (`AdminWiringDeps.objectStorage`, all six `RuntimeConfig` `S3_*` fields) is
optional and defaults to exactly the prior behavior — no existing caller (`apps/admin` composition,
`services/media/src/media-library.e2e.test.ts`, any other `wireMediaLibrary` invocation, every
existing `RuntimeConfig`-based test) passes them, so behavior is unchanged for every existing test and
environment except the new `APP_ENV != local` boot path, which previously booted silently wrong and
now fails loudly — the intended change. The `createS3Client` signature narrowing is backward
compatible: every existing caller (`createStorage`, passing a full `StorageConfig`) still satisfies
the narrower parameter type.

## Verification Results

All four required gates green, run against the full monorepo after the change:

- `pnpm typecheck` — 76/76 tasks passed (one real failure found and fixed mid-sprint: a call-site
  type error in the new Media adapter test caused by `InMemoryObjectStorage.exists()`'s own 0-arg
  signature — fixed by typing the local as `ObjectStoragePort`, `TS2554`).
- `pnpm lint` — 76/76 tasks passed, zero warnings.
- `pnpm test` (serialized, `turbo run test --concurrency=1`, per this host's known parallel-vitest
  flakiness) — 76/76 tasks; `@platform/media`: 5/5 test files passed (3 new adapter-delegation
  cases); `@platform/runtime`: 30/30 test files, 140/140 tests (5 new: 2 composition-resolution + 3
  guard cases); `@platform/storage`: 2 passed | 2 skipped (both live-MinIO suites honestly skipped,
  Docker unavailable, see Runtime Evidence above — not faked).
- `pnpm arch` — `✔ no dependency violations found (1531 modules, 6676 dependencies cruised)`.

**Real MinIO runtime verification:** attempted, not achievable in this sandbox (Docker Desktop daemon
did not come up after a 10+ minute wait); an honestly-gated integration suite exercising bucket
existence, upload, download, signed URLs, and content-type preservation was written and is ready to
run — and will run automatically, no code change needed — the next time this suite executes with
`STORAGE_TEST_BUCKET`/`S3_ENDPOINT`/`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` set against a live
MinIO (e.g. `infrastructure/docker/docker-compose.yml`'s `minio` + `createbuckets` services on a host
where Docker actually works).

---

**Scope discipline:** this report and its commit touch only the 12 files listed above (10 code/config

- 2 new test files). No other Medium finding (M2-1, M2-3 [already closed], M2-4 through M2-7) was
  investigated or modified. Per the sprint's stop condition, this closes M2-2 only.
