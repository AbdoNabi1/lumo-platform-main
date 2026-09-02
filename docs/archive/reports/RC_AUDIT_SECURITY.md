# Lumo Platform — Final Production Readiness Security Audit

Scope: read-only review of Kratos/Hydra/Keto, JWT handling, secrets/KMS, webhook signature
verification (Payments/Fulfillment/Shipping/Returns/Notifications), S3/MinIO object storage,
Kubernetes NetworkPolicies, and the `apps/runtime` fail-closed composition guards. All evidence
below is a direct read of current repository code (no assumptions from prior reports/memory
carried forward without re-verification).

---

## Confirmed Protections

### 1. Kratos (identity/session) — real, live, current

- `packages/auth/src/kratos.ts:61-155` — `KratosSessionAuthenticator` (session validation via
  `/sessions/whoami`) and `KratosIdentityService` (identity lookup + session revocation via the
  admin API) are real REST clients (no Ory SDK, injectable `fetch`), not stubs. Session
  revocation is WORM-audited (`kratos.ts:139-153`).
- `apps/runtime/src/security/ory-clients.ts:34-66` — `buildOryClients` constructs the live
  Kratos/Keto clients from runtime config; returns `null` only when `APP_ENV=local` and the Ory
  URLs are unset.
- `apps/runtime/src/security/ory-adapters.ts:49-75` — `KratosIdentityDirectory` (fail-closed:
  missing/non-active identity → `false`) and `KratosSessionRevoker` (throws on Kratos rejection
  so retry/DLQ re-drives a compromise-response logout) bind Security's ports to the live Kratos
  client.
- `apps/runtime/src/security/wire-security-identity.ts:54-113` — wires the live consumer fleet
  (`security.session.revoked_all` → `KratosSessionRevoker`, `security.relation.written/.deleted`
  → Keto sync). Returns `null` with a `logger.warn` only under `APP_ENV=local`.
- `apps/runtime/src/config.ts:175-186` (`superRefine`) — `KETO_WRITE_URL`, `KRATOS_PUBLIC_URL`,
  `KRATOS_ADMIN_URL` are **required outside `local`**; config fails to load otherwise. This is a
  genuine fail-closed gate, not documentation.
- **Verdict on prior memory claim ("H-2 closed, ADR-0031 session federation") — CONFIRMED, not
  reverted.** `apps/runtime/src/security/edge-zero-trust.ts:27-41,154-185` implements
  `SessionFederator`/`resolveSessionId` exactly as ADR-0031 describes: the upstream IdP `sid` is
  federated to a Security session id before `EvaluateAccess`; a refusal yields "no session," which
  fails closed for human principals (`edge-zero-trust.ts:179-184`).

### 2. Hydra (OAuth2/OIDC) — present only as a referenced external issuer, not as integrated code

- No `packages/auth/src/hydra.ts` or any Hydra admin-API client exists in the repository (only
  `packages/auth/src/jwt-verifier.ts` mentions "Kratos/Hydra" in a comment, generically, since the
  verifier is issuer-agnostic).
- `infrastructure/k8s/10-config.yaml:26-29` configures `AUTH_ISSUER_URL`/`AUTH_JWKS_URL` to point
  at `hydra.data.svc.cluster.local:4444/.well-known/jwks.json` — i.e., Hydra is assumed to run as
  the external token issuer whose JWKS the generic `JwtVerifier` (packages/auth/src/jwt-verifier.ts)
  consumes. `infrastructure/k8s/50-networkpolicy.yaml:64` opens egress port 4444 for it.
- **Finding: Hydra is referenced in infra config/docs as the intended issuer, but no OAuth2 client
  management, token-introspection, or consent-flow code exists anywhere in this repo.** State this
  explicitly rather than assume it — there is no Hydra-specific adapter to audit.

### 3. Keto (authorization) — real fail-closed guard, confirmed dev-mode-only permissive path

- `apps/runtime/src/composition.ts:144-162` is the actual guard code:
  ```
  if (config.KETO_READ_URL !== undefined) {
    accessControl = new CachedAccessControl(new KetoAccessControl({...}), redis.cache);
  } else if (config.APP_ENV === "local") {
    accessControl = { authorize: async () => true };
    logger.warn("authorization is permissive: KETO_READ_URL unset and APP_ENV=local");
  } else {
    throw new Error("KETO_READ_URL is required outside APP_ENV=local (authorization fails closed).");
  }
  ```
  This confirms the log warning quoted in the task is expected dev-mode behavior, and that any
  `APP_ENV` other than `local` throws at composition time (boot failure) rather than silently
  allowing all — i.e., production fails closed, not open.
- `packages/auth/src/keto.ts:27-59` — `KetoAccessControl.authorize` treats any non-200 response or
  transport exception as `false` ("fail-closed: any non-200 or transport failure denies... an
  authorization outage must not become an authorization bypass," `keto.ts:24-25`).
- `packages/auth/src/keto.ts:69-96` — `CachedAccessControl` caches both allow and deny decisions
  (TTL = revocation-latency window), not just allows.

### 4. JWT handling — real signature verification, audience/issuer checks present

- `packages/auth/src/jwt-verifier.ts:41-80` uses the `jose` library's `jwtVerify` against a
  `createRemoteJWKSet` (real JWKS-based signature verification, not stubbed) with explicit
  `issuer`, `audience`, and `clockTolerance` (default 30s) checks (`jwt-verifier.ts:63-67`).
  Invalid tokens resolve to `null` uniformly (never throw), keeping 401 behavior flat across
  failure modes.
- `apps/runtime/src/composition.ts:132-142` — composition throws if `AUTH_JWKS_URL`/
  `AUTH_ISSUER_URL` are unset ("there is no fake identity provider (D-048)").
- `toPrincipal` (`jwt-verifier.ts:84-97`) validates `sub` is a non-empty string and constrains
  `kind`/`roles` claims to known shapes before trusting them.

### 5. Secrets / KMS / HSM

- `packages/secrets/src/envelope.ts` implements real envelope encryption (`EnvelopeCipher`,
  `KeyAliasRegistry`) — fresh data key per `seal()`, KEK wrapping delegated to an injected
  `KeyWrapCipher` (never implements ciphers itself), self-describing sealed envelopes so key
  rotation never strands old data (`envelope.ts:82-111`).
- `apps/runtime/src/security/` contains real cloud KMS/HSM adapters: `kms-aws.ts`, `kms-cloud.ts`,
  `kms-base.ts`, `hsm-providers.ts`, `aws-sigv4.ts` (SigV4 request signing), consistent with the
  memory claim of H-3/G-SEC-2 cloud KMS/HSM wiring.
- **No hardcoded secrets found** in the areas requested (`apps/runtime/src`,
  `services/payments/src`, `services/security/src`). The only string matches for
  password/apiKey/secret patterns were: (a) `apps/runtime/src/security/security-log-context.test.ts:8-9`
  — test fixtures (`"hunter2"`, `"sk-123"`) verifying that the log-redaction helper (`redact`)
  correctly masks those field names — not a real credential; (b)
  `apps/runtime/src/security/wire-security-providers.test.ts:80-81` — fake test values `"a"`/`"b"`
  for threat-intel API key config in unit tests. Real S3 credentials in `.env.example:46-49`
  (`S3_ACCESS_KEY_ID=minioadmin` / `S3_SECRET_ACCESS_KEY=minioadmin`) are the well-known MinIO
  local-dev default, not a leaked production secret, and are only consumed via env vars
  (`apps/runtime/src/composition.ts:176-192`, `packages/storage/src/client.ts:15-25`) — never
  inlined in source.

### 6. Object Storage (M2-2 S3/MinIO adapter) — credentials not leaked, access is signed-URL-scoped

- `packages/storage/src/client.ts:15-25` — `createS3Client` builds the S3 client entirely from
  injected config (`endpoint`, `region`, `forcePathStyle`, `accessKeyId`, `secretAccessKey`); no
  credential is hardcoded or logged.
- `packages/storage/src/storage.ts:19-70` — `S3StorageService` is scoped to a single bucket
  (`readonly bucket: string`), and both upload and download access is issued as **time-limited
  signed URLs** (default 900s expiry, `storage.ts:27,46,53`) rather than the application proxying
  bytes or exposing raw credentials to clients — clients get a signed URL, never the access
  key/secret.
- `apps/runtime/src/composition.ts:176-192` — the real `StorageServiceObjectStorage` is only
  constructed when `S3_ENDPOINT`+`S3_ACCESS_KEY_ID`+`S3_SECRET_ACCESS_KEY` are all configured;
  otherwise `InMemoryObjectStorage` is used, and `apps/runtime/src/api.ts:81-96`
  (`assertProductionObjectStorageConfigured`) **throws outside `local`** if the resolved adapter is
  still the in-memory stub — fail-closed, confirming the M2-2 memory claim.

### 7. Network Policies — real least-privilege rules, not just file presence

`infrastructure/k8s/50-networkpolicy.yaml` (226 lines) implements a genuine
default-deny-all + explicit-allow model, read in full:

- Lines 6-13: `default-deny-all` — `podSelector: {}`, `policyTypes: [Ingress, Egress]` applies to
  every pod in `lumo-runtime`.
- Lines 15-33: DNS egress restricted to `kube-system` namespace, ports 53 UDP/TCP only.
- Lines 34-67: infra egress (`allow-infra-egress`) opens only specific ports needed
  (Postgres 5432, Redis 6379, Kafka/Redpanda 9092, Keto read 4466/write 4467, Kratos public
  4433/admin 4434, Hydra JWKS 4444, outbound TLS 443).
- Lines 70-87: `allow-api-ingress` restricts inbound traffic to the runtime-api pod to only
  `ingress-nginx` namespace on port 3080.
- Lines 90-105: metrics scrape restricted to the `monitoring` namespace only.
- Lines 106-134, 142-157, 159-226: collector, Debezium Connect, and storefront ingress/egress are
  each pod-selector-scoped to the minimum required peer, not blanket-opened.
- **Self-documented limitation** (`50-networkpolicy.yaml:1-5`): infra egress rules (Postgres,
  Redis, Kafka, Keto, Kratos) are scoped **by destination port only**, not by namespace/pod
  selector or IP block, because "infra may live in another namespace or be external." See
  Remaining Risks — this is a real, currently-open gap, not resolved.

### 8. Runtime fail-closed guards (apps/runtime/src/api.ts and composition.ts) — cross-referenced, all present and current

| Guard                                                                        | Location                                                                             | Outside `local` behavior                     |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------- |
| Authorization (Keto)                                                         | `composition.ts:144-162`                                                             | throws at composition (boot failure)         |
| Authentication (JWT issuer/JWKS)                                             | `composition.ts:132-142`                                                             | throws at composition                        |
| Ory identity binding (Kratos/Keto sync)                                      | `config.ts:175-186` (superRefine)                                                    | config load fails                            |
| MFA (`InMemoryTotpMfaProvider`, hardcoded code `123456`)                     | `api.ts:120-133`                                                                     | throws before `createAdminHttpApi` is called |
| Payments PSP (`InMemoryPaymentProvider.verifyWebhook` always `true`)         | `api.ts:24-38` (`assertProductionPaymentProviderConfigured`), called at `api.ts:135` | throws                                       |
| Licensing billing (`InMemoryPaymentsAdapter`/`InMemoryFinanceLedgerAdapter`) | `api.ts:53-67`, called at `api.ts:136`                                               | throws                                       |
| Object storage (`InMemoryObjectStorage`)                                     | `api.ts:81-96`, called at `api.ts:137`                                               | throws                                       |

All five guards run **before** `createAdminHttpApi` is invoked (`api.ts:117-168`), so a
misconfigured non-local deployment refuses to boot the process entirely rather than silently
running with any of these stubs live. This is a strong, verifiable control.

---

## Remaining Risks

### R1 — Payments webhook signature verification is a no-op stub with no real-adapter injection seam (Critical, blocks GA for real payment processing; does NOT block RC because the boot guard prevents it running unverified in any non-local environment)

- `services/payments/src/infrastructure/in-memory-port-adapters.ts:34-36` — the **only**
  `implements PaymentProvider` in the repository:
  ```
  async verifyWebhook(): Promise<boolean> {
    return true;
  }
  ```
  It ignores both `payload` and `signature` arguments entirely.
- `apps/admin/src/http/payments-webhook-routes.ts:33-67` — the public `/payments/webhook` route
  (`public: true`, no admin Bearer token) calls exactly this stub as its sole authentication
  (`admin.paymentsWebhook.verifyWebhook(payload, body.signature)`, line 52).
- `services/payments/src/composition.ts:80,144-210` — `PaymentsWiringDeps` (lines 44-58) has **no**
  `paymentProvider` field; `InMemoryPaymentProvider` is constructed unconditionally in both the
  Prisma and in-memory branches. There is no way to inject a real PSP adapter today — the
  "swap it at the composition root" comment (`in-memory-port-adapters.ts:9-12`) describes a seam
  that does not exist in code.
- **Mitigation that DOES exist and is real**: `apps/runtime/src/api.ts:24-38` unconditionally
  throws outside `APP_ENV=local`, refusing to boot the whole API process. So the vulnerable path
  cannot run in a live deployment today — this converts what would otherwise be a live
  unauthenticated-webhook-forgery vulnerability into a "feature not yet implemented, and the
  runtime knows it" state. **Severity is Critical for GA** (Payments cannot process real money —
  `createIntent`/`capture`/`refund` are also all stubs) but the specific signature-bypass
  vulnerability is not reachable in any environment that isn't already explicitly `local`.

### R2 — Fulfillment/Shipping/Returns/Notifications webhook and callback endpoints have zero cryptographic signature verification of any kind (Medium; not a live bypass today because they require admin Bearer auth, but this is a functional gap, not a security control)

- `services/fulfillment/src/application/record-carrier-webhook.use-case.ts:42` and
  `services/shipping/src/application/record-carrier-webhook.use-case.ts:44` both state:
  "Signature verification is the carrier adapter's job, never this use case's" — but **no carrier
  adapter with a `verifyWebhook`/signature-check method exists anywhere** (only
  `InMemoryCarrierProvider` in `services/fulfillment/src/infrastructure/in-memory-port-adapters.ts`
  and `services/shipping/src/infrastructure/in-memory-port-adapters.ts`, neither of which has a
  verification method — the `CarrierProviderPort` interface itself has no `verifyWebhook` method).
- `apps/admin/src/http/fulfillment-routes.ts:79-89` and `apps/admin/src/http/shipping-routes.ts:105-114`
  gate their webhook routes behind `permission: "fulfillment:record_webhook"` /
  `"shipping:record_webhook"` (AdminGuard, staff Bearer token) — **not** `public: true`. As the
  repo's own `docs/investigations/C-05-payments-no-psp-or-ingress.md:90-97` notes, this means no
  real carrier can ever call these endpoints (they'd need an internal staff token), so the current
  state is "safe by unreachability," not "safe by verification."
- `services/notifications/src/application/record-provider-callback.use-case.ts` (full file read):
  no signature/authenticity check at all, only idempotent dedup by `(provider, callbackId)`; its
  HTTP route (`apps/admin/src/http/notifications-routes.ts:90-96`, `permission:
"notifications:callback"`) is likewise AdminGuard-gated, not signature-verified.
- `services/returns/src/application/ports.ts:36-40` (`ProcessedWarehouseCallbackStore`) — same
  pattern: idempotent dedup only, no cryptographic verification; its route
  (`apps/admin/src/http/returns-routes.ts:22`) is also AdminGuard-gated.
- **Risk**: none of these four contexts has a real, callable webhook signature-verification
  mechanism — the design intent ("carrier adapter's job") was never implemented. Today they are
  not exploitable as forgeable endpoints (admin auth blocks external callers), but they are also
  **not functional** — no real carrier/PSP/warehouse system could call them successfully without
  possessing an internal admin credential, which is itself an anti-pattern for third-party webhook
  ingress. Recommend building real signature-verified `public: true` routes analogous to the
  Payments pattern (which at least has the right shape, `payments-webhook-routes.ts`) before GA.

### R3 — MFA, Payments, Licensing-billing, and Object-storage guards are unconditional appEnv checks, not "is a real adapter configured" checks (Low/Medium — correctly fails closed, but means these subsystems cannot function in any non-local deployment at all today)

- `apps/runtime/src/api.ts:117-137` — all four guards gate purely on `config.APP_ENV === "local"`.
  For MFA/Payments/Licensing, there is no config-driven injection point wired into
  `createAdminHttpApi({...})` at all (`api.ts:145-168` passes no `mfaProviders`/`paymentProvider`/
  `payments`/`financeLedger` fields) — so these guards will **always** throw in
  staging/production today, regardless of any future config change, until someone also wires the
  injection call. This is intentional and correctly conservative (no accidental silent stub), but
  it means: **the runtime cannot boot in any non-local environment until real PSP + MFA + Licensing
  billing adapters exist and are wired**, which is a blocker for any real staging/production
  deployment, not just a note. Object storage (`assertProductionObjectStorageConfigured`,
  `api.ts:81-96`) is the one exception — it conditionally passes once S3 env vars are set, since
  `buildRuntimeCore` already wires a real adapter when configured (`composition.ts:176-192`).

### R4 — NetworkPolicy egress for infra (Postgres/Redis/Kafka/Keto/Kratos) is port-scoped only, not namespace/pod/IP-scoped (Low; explicitly flagged in the file's own comments as a follow-up)

- `infrastructure/k8s/50-networkpolicy.yaml:1-5,34-67` — the `allow-infra-egress` rule has no
  `to:` peer selector at all, only `ports:` — meaning any pod in `lumo-runtime` can reach **any**
  destination in the cluster (or beyond, if egress isn't otherwise restricted at the CNI/cloud
  level) on ports 5432/6379/9092/4466/4467/4433/4434/4444/443. A compromised runtime pod could
  attempt lateral movement to any service listening on one of those ports, not just the intended
  Postgres/Redis/Kafka/Keto/Kratos instances. The file's own header comment acknowledges this
  ("Tighten `to:` with namespace/pod selectors or ipBlocks once the infra placement is known").
  Does not block RC (default-deny plus port-scoping is still meaningfully better than an open
  cluster) but should be closed before GA once infra namespace placement is finalized.

### R5 — Hydra has no integrated client code (Low/Informational — not a defect, just a scope note for the report)

- Confirmed no Hydra SDK/adapter exists. `AUTH_JWKS_URL`/`AUTH_ISSUER_URL` are generic
  JWKS/issuer config consumed by the issuer-agnostic `JwtVerifier`
  (`packages/auth/src/jwt-verifier.ts`), and `infrastructure/k8s/10-config.yaml:26-29` assumes
  Hydra will be the thing running at that URL in production. There is no OAuth2 client-management,
  token-introspection, or consent-app code to audit because none exists. Flag as a documentation
  gap only if the platform's stated architecture claims a Hydra integration beyond "external JWKS
  issuer" — I found no such code-level claim.

### R6 — Discrepancy check on prior memory claims

- **No discrepancies found.** Every prior-memory claim explicitly asked to be re-verified (H-2
  Kratos/Keto live wiring + ADR-0031 session federation, M2-2/M2-3/M2-7/C2-4 fail-closed guards,
  H-3 KMS/HSM adapters) was independently confirmed present and current in code, with line-level
  evidence above. The one area where current code is **more cautious** than a casual reading of
  memory might suggest is Payments: the M2-7 closure note ("wired consumer path's MarkOrderPaid to
  PrismaPaymentVerificationAdapter") is accurate and confirmed
  (`apps/runtime/src/composition.ts:267-273`), but that is a narrower fix than "Payments webhook
  verification is real" — the webhook signature check itself (R1 above) remains a stub. This is
  not a reversion, just a scope distinction worth being precise about in the RC report.

---

## Severity / RC-GA Summary

| #   | Risk                                                                                                          | Severity           | Blocks RC?                                                                                                    | Blocks GA?                                           |
| --- | ------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| R1  | Payments webhook `verifyWebhook` is an unconditional-`true` stub, no injection seam                           | Critical           | No (boot guard prevents it running outside `local`)                                                           | Yes                                                  |
| R2  | Fulfillment/Shipping/Returns/Notifications have no real signature verification, only admin-auth-gated ingress | Medium             | No                                                                                                            | Yes (for any real carrier/PSP/warehouse integration) |
| R3  | MFA/Payments/Licensing guards make non-local boot impossible until real adapters exist                        | High (operational) | Depends on RC deployment target — if RC means "deployed to staging/production," **yes, this blocks it today** | Yes                                                  |
| R4  | Infra egress NetworkPolicy is port-scoped, not peer-scoped                                                    | Low                | No                                                                                                            | Recommended before GA                                |
| R5  | Hydra has no client-side integration code                                                                     | Informational      | No                                                                                                            | N/A — scope note                                     |

Everything explicitly asked to be verified against prior memory (Kratos/Keto live wiring,
ADR-0031 session federation, KETO_READ_URL fail-closed guard, JWT verification,
KMS/HSM/EnvelopeCipher, M2-2/M2-3/M2-7 boot guards) is confirmed present and unreverted in current
code, with file:line evidence.
