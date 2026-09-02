# Sprint 2.4 Report — Storage Layer

> 2026-07-05. Scope per Phase-2 step 4. No unrelated packages touched; ADRs frozen and honored.

## Delivered

**Ports (`@platform/contracts`, D-018):** `ObjectStorage` (immutable put via conditional write,
stream get, head, permanent delete — soft delete/retention ride bucket versioning + lifecycle
per doc 26 §5), `SignedUrlProvider` (download + future browser uploads), `MultipartUpload`
(create/uploadPart/listParts=resume/complete/abort), `ObjectDescriptor`/`ObjectMetadata`
(tenant/owner/context/aggregateId/contentType/size/checksum/createdBy/createdAt/tags),
`StorageNamespace` (all 14 object kinds from the sprint list), `ByteStream`
(`AsyncIterable<Uint8Array>` — contracts stay Node-free), `FileScanner` hook (fail-closed
quarantine contract; adapter deferred until the first user-upload surface) and
`ImageTransformer` seam (derived keys only, source never mutated; NO processing per scope).

**Storage package:** `StorageKeyFactory` — the ONLY sanctioned key producer:
`tenants/<tenantId>/<namespace>/<yyyy>/<mm>/<uuid>[.ext]` (tenant-isolated, immutable,
collision-free, CDN-friendly, time-bucketed, hostile-filename-proof; clock/idGenerator injected
⇒ deterministic tests); `resolveBucket` namespace→bucket mapping (media/exports/imports/backups);
`validateUpload` + `UploadPolicy` (allowlist mime/extension/size, Result-pattern, pure);
`S3ObjectStorage` — one adapter implementing all three ports against MinIO/S3/R2
(`If-None-Match: *` immutability, server-verified SHA-256 checksums, descriptor→user-metadata
round-trip, multipart with resume via listParts). Existing signed-URL `StorageService` kept
untouched (back-compat).

**Tests:** 9 green unit tests (key strategy incl. `../../etc/passwd` defense + tenant-id guard;
policy validation incl. parameter-stripped mime matching); integration suite (immutability
rejection, metadata/stream round-trip, signed-URL expiry, multipart create/resume/abort)
**honestly gated** on `STORAGE_TEST_BUCKET`+`S3_ENDPOINT`+AWS creds. Storage package gained its
first real vitest wiring (the Sprint-0.2 `echo "no tests yet"` stub is gone).

## Design decisions (D-045) / tradeoffs / alternatives rejected

- **Immutable keys, version = new key** — enables CDN cache-forever and makes overwrite a
  provider-enforced error. _Rejected:_ mutable keys + cache purging (purge fan-out is the
  classic CDN failure), S3 object versioning as the primary story (versioning is retained for
  soft delete/retention, not for identity).
- **Buckets by purpose, tenants by prefix** — per-tenant lifecycle/export/erasure by prefix
  (ADR-0008/G-32). _Rejected:_ bucket-per-tenant (provider bucket limits die at Shopify-scale
  tenant counts).
- **`ByteStream = AsyncIterable<Uint8Array>`** — framework independence in contracts.
  _Rejected:_ Node `Readable` in the port (couples every consumer to Node types).
- **Scanner/transformer as interfaces only** — the seam is the deliverable; implementations
  without a serving/upload surface would be untestable speculation.
- **Conditional-write requirement** documented on the adapter: providers without
  `If-None-Match` support are not acceptable for the media bucket.

## Long-term cost / debt / deferred

Port family grows (bounded, cohesive). Deferred by scope: scanner adapter + quarantine flow
(first upload surface), image pipeline (storefront phase, G-28), one-time downloads (transport),
lifecycle/retention config-as-code (broker/ops sprint), running the gated suite (first-boot
runbook). No new debt.

## Validation

lint/typecheck/test/build **103/103** ✅ · dependency-cruiser **0 violations (407 modules)** ✅ ·
`prisma validate`/`generate` ✅ · storage integration ⛔ gated (Docker engine down — never faked).
