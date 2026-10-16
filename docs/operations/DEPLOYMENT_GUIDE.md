# Deployment Guide

> How a built, scanned, signed runtime image reaches an environment. This documents the **existing**
> pipeline (`.github/workflows`) and manifests (`infrastructure/k8s`, `infrastructure/docker`) — H-5
> adds signing, monitoring, and the runbooks that back it.

## Artifacts

One immutable image serves all three runtime processes (`api` / `worker` / `scheduler`); the
Kubernetes/compose `args` select the entrypoint. Images are addressed by **digest**, never a mutable
tag, from the release onward.

- Image: `ghcr.io/<org>/morbeh-platform/runtime@sha256:…`
- Dockerfile: [`infrastructure/docker/runtime.Dockerfile`](../../infrastructure/docker/runtime.Dockerfile)
- SBOM + provenance: attached as buildx attestations; SPDX SBOM also published as a workflow artifact.
- Signature: cosign keyless (OIDC) — verify before rollout (see below).

## Pipeline (already wired)

```
PR ──▶ validate.yml (typecheck·lint·arch·test·governance·dup)
       security.yml (audit·gitleaks·trivy·sbom·licenses)
tag v*.*.* ──▶ release.yml ─▶ validate ─▶ security ─▶ build(push) ─▶ cosign sign ─▶ GitHub Release
manual  ──▶ deploy.yml (env: dev|staging|production) ─▶ validate ─▶ re-scan digest ─▶ kubectl apply
```

`production` is a protected GitHub Environment — configure **required reviewers** so prod rollout
needs manual approval.

## Verify the image before rollout

```bash
DIGEST=ghcr.io/<org>/morbeh-platform/runtime@sha256:<digest>
cosign verify "$DIGEST" \
  --certificate-identity-regexp "https://github.com/<org>/morbeh-platform/.github/workflows/.+" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
cosign verify-attestation --type spdxjson "$DIGEST" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp "https://github.com/<org>/morbeh-platform/.+"
```

## Deploy to Kubernetes

Manifests live in [`infrastructure/k8s`](../../infrastructure/k8s) (kustomize base). They are
production-shaped: non-root, read-only rootfs, dropped capabilities, `RuntimeDefault` seccomp, HPA,
PDB, NetworkPolicy, resource limits, and startup/liveness/readiness probes.

```bash
# 1. Pin the image digest (never a tag) for this release.
cd infrastructure/k8s
kustomize edit set image morbeh-runtime=$DIGEST

# 2. Provide secrets out-of-band (never commit them). See secret.example.yaml.
kubectl apply -f <your-sealed-or-external-secret>

# 3. Roll out.
kubectl apply -k .
kubectl -n morbeh-runtime rollout status deploy/runtime-api --timeout=180s
kubectl -n morbeh-runtime rollout status deploy/runtime-worker --timeout=180s
```

Rollout is zero-downtime: `maxUnavailable: 0`, `maxSurge: 1`, a `preStop` drain, and
`terminationGracePeriodSeconds: 30` covering the bounded 10s graceful shutdown.

### Rollback

```bash
kubectl -n morbeh-runtime rollout undo deploy/runtime-api
kubectl -n morbeh-runtime rollout undo deploy/runtime-worker
```

The image is immutable and DB migrations are expand-only (see [UPGRADE_GUIDE](UPGRADE_GUIDE.md)), so a
rollback of the app is always safe within a compatibility window.

## Deploy locally (parity)

```bash
docker compose -f infrastructure/docker/docker-compose.yml \
               -f infrastructure/docker/docker-compose.runtime.yml \
               up -d --build
```

This also starts Prometheus, Alertmanager, and Grafana (dashboards auto-provisioned) — see
[MONITORING](#monitoring).

## Monitoring

- Prometheus scrapes each runtime `/metrics` (`morbeh-runtime` job) + OTel + Redpanda.
- Grafana (`http://localhost:3001`, admin/admin locally) auto-loads the _Morbeh_ folder dashboards.
- Alerts route through Alertmanager (`:9093`); wire real receivers via env at deploy time.
- SLOs and burn-rate alerts: [SLO_SLI](SLO_SLI.md).

## Configuration & secrets

`ConfigMap` (`10-config.yaml`) holds non-secret env; `Secret` (`secret.example.yaml` template) holds
credentials, sourced from the secret manager / Vault (never committed). See
[BACKUP_AND_RECOVERY](BACKUP_AND_RECOVERY.md#key-rotation) for rotation.

## Pre-deploy guard checklist (T6.5, `docs/plans/PHASE-5-6-backlog.md`)

`apps/runtime/src/api.ts`'s `startApi` runs 5 fail-closed guards that abort boot outside
`APP_ENV=local` (`collectGuardFailure` aggregates every failure into one error instead of
discovering them one boot attempt at a time — see that file's own doc comments for the full
reasoning behind each). **Never weaken a guard to make a deploy proceed** — each documents a
specific incident class. This table lists the guards `startApi` currently runs, and the
integration-ports guard's own four sub-ports below it; `C2-4` is closed as of the real
`TotpMfaProvider` — it needed no operator action, but is listed for completeness:

| Guard   | Kind                                    | What it needs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `C2-4`  | **closed — no action needed**           | `buildRuntimeCore` now resolves a real RFC 6238 `TotpMfaProvider` (`services/security/src/infrastructure/totp-mfa-provider.ts`) unconditionally, threaded through `createAdminHttpApi`'s `mfaProviders` deps — unlike Stripe/S3 below, this needed no external account, just a `CryptoPort` (`NodeCrypto` locally; swap for a KMS-backed one via the KMS row below). `assertProductionMfaConfigured` now fails closed only if the resolved `totp` provider is still `InMemoryTotpMfaProvider`, which this composition never produces. |
| `V-1`   | **config-only**                         | `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` (`.env.example` lines ~139-142) — `buildRuntimeCore` already resolves a real `StripePaymentProvider` when both are set.                                                                                                                                                                                                                                                                                                                                                                 |
| `M2-2`  | **config-only**                         | `S3_ENDPOINT` + `S3_ACCESS_KEY_ID` + `S3_SECRET_ACCESS_KEY` (`.env.example` lines ~65-68) — same shape, `StorageServiceObjectStorage` already exists.                                                                                                                                                                                                                                                                                                                                                                                 |
| `M2-3`  | **needs new code**                      | `services/licensing`'s `PaymentsPort`/`FinanceLedgerPort` are wired to in-memory stubs (`collect()` always succeeds, `postSettlement()` is a no-op) with no real PSP-backed adapter anywhere in this codebase. Needs `payments`/`financeLedger` adapters built and passed the same way C2-4's provider is — also needs a `tenantRef → Stripe customer` mapping, which does not exist in `packages/db/prisma/schema/licensing.prisma` today (a schema migration, not just an adapter).                                                 |
| `C-03`  | **needs new code**                      | The integration-ports guard (`assertProductionIntegrationPortsConfigured`) — `taxCalculation`, `shippingCalculation`, `shippingPort` are genuinely-missing capabilities (no tax/shipping-rate provider exists; `shippingPort` additionally needs a `weightGrams` field nothing in Catalog/Orders/Fulfillment stores today). `financePort` is deliberately left unwired — see the guard's own doc comment in `apps/runtime/src/api.ts` before changing this.                                                                           |
| — (KMS) | **config, plus a real gap — see below** | `SECURITY_KMS_PROVIDER` (`.env.example` line ~181) defaults to `local` (`node:crypto`, in-process, unmanaged). Setting it to `vault`/`aws`/`gcp`/`azure` plus that provider's own required vars (`.env.example` lines ~199-214) makes `wireSecurityProviders` (`apps/runtime/src/security/wire-security-providers.ts`) resolve a real KMS-backed `CryptoPort`/`KmsPort`.                                                                                                                                                              |

**The KMS row is not fail-closed today, unlike the other four.** `config.ts`'s zod refinement
(lines ~264-293) validates that IF you explicitly set a non-`local` `SECURITY_KMS_PROVIDER`, its
required keys are present — but nothing aborts boot if `SECURITY_KMS_PROVIDER` is simply left at
its `local` default outside `APP_ENV=local`, the way `assertProductionMfaConfigured`/
`assertProductionPaymentProviderConfigured`/`assertProductionLicensingBillingConfigured`/
`assertProductionObjectStorageConfigured` do for the other four. This is also a different
_process_ from the other four: `wireSecurityProviders`/`wireSecurityRuntime` are invoked from
`apps/runtime/src/worker.ts` (grep confirms `api.ts`/`apps/admin/src/composition.ts` never call
them), which has no fail-closed guards of any kind today — `startApi`'s 5-guard block is specific
to the `api` process, not `worker`. Recorded as a found gap, not fixed here — see
`docs/plans/BLOCKERS.md`'s T6.5 entry for why (adding a new boot guard to a process this session
could not actually boot and test is exactly the kind of safety-critical change that needs live
verification before merging, not a blind addition).
