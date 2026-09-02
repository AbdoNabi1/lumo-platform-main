# M2-6 Remediation Report — Storefront Runtime Deployment

**Finding:** M2-6 — "The storefront is built but not deployed" (`FINAL_PRODUCTION_READINESS_AUDIT_v2.md`), last remaining executable item in the Medium register per `MEDIUM_REMEDIATION_PLAN.md` §5 and [[lumo-m2-5-observability-disclosure]]'s closing note.
**Baseline:** `HEAD 162536f` (where M2-5 left the repo).
**Result:** **CLOSED.** One commit. All four gates green. Static manifest verification only — no live Kubernetes/Docker runtime was available in this sandbox (see Runtime Evidence).

---

## Investigation

Re-derived the finding from current source rather than trusting the prior audit's citations (evidence-first, per the standing Lumo persona):

| Area                       | Command / check                                                   | Result before this sprint                                                                                                                                                                                                                                                               |
| -------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI image build             | Read `.github/workflows/build.yml`                                | Two jobs only: `image` (runtime) and `collector-image` (H-07). **No `storefront-image` job.**                                                                                                                                                                                           |
| Kubernetes manifests       | `Get-ChildItem infrastructure/k8s`                                | `00-namespace`, `10-config`, `20/21/22-deployment-{api,worker,scheduler}`, `25/26-collector-*`, `30-services`, `40-autoscaling`, `50-networkpolicy`, `60-ingress`, `70-debezium`, `kustomization`. **Zero storefront entries anywhere.**                                                |
| Container image            | Read `infrastructure/docker/web.Dockerfile`                       | **Already exists and is production-ready** — multi-stage (`base`→`deps`→`builder`→`runner`), non-root user (`nextjs`, uid/gid 1001), `next.config.ts` already sets `output: "standalone"` (confirmed the standalone `COPY` steps have a real source to copy from).                      |
| Build pipeline             | `pnpm build` (turbo)                                              | `storefront:build` already runs and succeeds as part of the monorepo build — the app itself was never broken, only its path to a deployed container.                                                                                                                                    |
| Runtime bootstrap          | Read `apps/storefront/src/app/page.tsx`, `src/lib/runtime-api.ts` | Storefront is a Next.js Server Component app; `runtime-api.ts` calls the Runtime API's public routes via `process.env.RUNTIME_API_URL ?? "http://localhost:3080"`, degrading to `null`/friendly-fallback UI on any failure — by design, never a hard error.                             |
| Health/readiness/liveness  | `Glob apps/storefront/src/**/*`                                   | **No API routes exist at all** (only `layout.tsx` + `page.tsx`) — no `/healthz`/`/readyz`. The image's own `HEALTHCHECK` (web.Dockerfile) and `docker-compose.yml`'s `web` service healthcheck both already probe `/` — an established, not invented, convention for this specific app. |
| Config wiring              | Read `runtime-api.ts`                                             | `RUNTIME_API_URL` is already an env var (config-driven), but nothing supplies a production value — the code's `localhost:3080` fallback is dev-only and would silently misresolve in a cluster.                                                                                         |
| Environment variables read | `grep process.env apps/storefront/src`                            | Only `RUNTIME_API_URL` and `TENANT_DEFAULT_ID` (plus Next's own `PORT`/`NODE_ENV`). No `APP_ENV`/`NEXT_PUBLIC_*` reads anywhere in source — confirmed before writing the ConfigMap, so no unused/invented keys were added.                                                              |

## Root Cause

Three independent, purely additive gaps — same shape as the H-07 collector gap this sprint mirrors, not a design defect:

1. **No image build job.** `build.yml` never built `web.Dockerfile` into a pushable image, so there was never an artifact to deploy.
2. **No Kubernetes manifests.** No Deployment/Service/Ingress/HPA/PDB/NetworkPolicy for the storefront existed anywhere in `infrastructure/k8s/`, so `kubectl apply -k .` had nothing to apply for it.
3. **No production API-target wiring.** `RUNTIME_API_URL`'s only real value anywhere in the repo was the code's own `localhost:3080` dev fallback — there was no ConfigMap supplying the in-cluster value, so even a deployed storefront pod would have tried (and failed) to reach `localhost:3080` inside its own container.

No active production-safety bug in anything already running — correctly assessed as "High operational-readiness risk (blocks launch), no active bug" in the original audit and reconfirmed here.

## Code / Config Changes

Purely additive infrastructure wiring — **zero application source files changed**, zero public APIs, zero event contracts, zero new bounded contexts:

1. **`.github/workflows/build.yml`** — new `storefront-image` job, structurally identical to `collector-image` (same auth, same attestation flags, same metadata-action tag scheme), building `infrastructure/docker/web.Dockerfile`'s default (`runner`) stage into `ghcr.io/<repo>/storefront`. Two new reusable-workflow outputs (`storefront_image`, `storefront_digest`) mirroring the existing `collector_image`/`collector_digest` pair.
2. **`infrastructure/k8s/27-storefront-config.yaml`** (new) — ConfigMap `lumo-storefront-config`: `NODE_ENV`, `PORT`, `RUNTIME_API_URL` (now the real in-cluster `runtime-api` Service DNS), `TENANT_DEFAULT_ID`. No Secret — storefront has zero credentialed env vars (confirmed by grep), so none was invented.
3. **`infrastructure/k8s/28-deployment-storefront.yaml`** (new) — Deployment mirroring `26-deployment-collector.yaml`'s security posture (non-root uid **1001**, matching `web.Dockerfile`'s `nextjs` user — deliberately not 1000 like runtime/collector, which use a different image), read-only rootfs, dropped capabilities, topology spread, `preStop` drain. Probes target `/` on port 3000 (the only route the app has), not `/healthz`/`/readyz` — same convention the image's own `HEALTHCHECK` and `docker-compose.yml` already use, not a new pattern. No `args` override (unlike runtime/collector): `web.Dockerfile` has no `tini` `ENTRYPOINT` to preserve, so the image's own `CMD` runs as-is.
4. **`infrastructure/k8s/30-services.yaml`** — added the `storefront` ClusterIP Service (port 3000), same shape as the existing three.
5. **`infrastructure/k8s/40-autoscaling.yaml`** — added `storefront` HPA (CPU 70%, 2–10 replicas) + PDB (`minAvailable: 1`), same shape as `collector`'s.
6. **`infrastructure/k8s/50-networkpolicy.yaml`** — three new least-privilege rules under the existing default-deny-all model:
   - `allow-storefront-ingress` — public traffic from `ingress-nginx` to the storefront pod, port 3000 (mirrors `allow-api-ingress`/`allow-collector-ingress`).
   - `allow-storefront-egress-to-api` + `allow-storefront-to-api-ingress` — a pod-selector-scoped pair allowing the storefront's server-side fetches to reach the `runtime-api` pod on port 3080. **This pair is necessary, not decorative**: `allow-infra-egress` only opens ports for external stateful stores (Postgres/Redis/Redpanda/Keto/Kratos/Hydra), not the in-namespace `runtime-api` pod, and `allow-api-ingress` only admits traffic from `ingress-nginx`. Without these two rules, the storefront would be deployed but silently unable to reach the API under the cluster's own default-deny policy — every page load would show the "Connect the Runtime API" fallback despite the API being healthy, because the network policy (not the API) was the blocker.
7. **`infrastructure/k8s/60-ingress.yaml`** — added the `storefront` Ingress (host `www.lumo.example.com`, path `/` → the new Service). Deliberately **omits `Content-Security-Policy`**: `docs/operations/SECURITY_HARDENING.md` (pre-existing) explicitly documents that the API Ingress's `default-src 'none'` policy must never be copied onto an HTML surface verbatim, and that an HTML edge needs a script/style-permissive, nonce-based CSP — building that is real, non-trivial application-level work (Next.js middleware nonce wiring) outside this finding's scope. Shipping a fabricated CSP guess risked silently breaking Next.js hydration with no way to verify it in this sandbox (Docker unavailable) — the honest choice was to carry forward the other safe, static headers (HSTS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, cleared `Server`) and leave CSP as a disclosed, documented gap rather than invent one.
8. **`infrastructure/k8s/kustomization.yaml`** — registered the two new manifest files.

**Deliberately not touched (would have been scope creep beyond this finding):**

- `apps/storefront/src/lib/runtime-api.ts` — needed no code change. It already reads `RUNTIME_API_URL` from the environment; supplying the real value via the new ConfigMap (item 2 above) is what makes the production target config-driven, exactly as the remediation plan asked, without touching application code.
- `infrastructure/docker/web.Dockerfile` — already correct and already used by `docker-compose.yml`; not modified. (It has no `tini` init, unlike `runtime.Dockerfile`/`collector.Dockerfile` — noted as a residual, pre-existing characteristic of the image itself, not something M2-6 asked to fix; Node's own SIGTERM handling is the fallback.)
- `.github/workflows/release.yml` (cosign signing) and `deploy.yml` (rollout-wait list, `kustomize edit set image`) — neither currently covers the **collector** image either (verified by reading both files), so extending storefront further than collector's own precedent would have been new scope, not a mirror of an established complete pattern. Flagged below as a shared residual gap.

## Production Impact

Positive only: the storefront now has a real path to production (image job → manifests → `kubectl apply -k .` already applies everything registered in `kustomization.yaml`, so `deploy.yml`'s existing "Pin image + apply manifests" step deploys the storefront automatically, no workflow change needed there). Nothing previously running is touched.

## Regression Risk

**Low**, matching the plan's own estimate — every change is a new file or a new, independent block appended to an existing multi-document YAML file; no existing Deployment/Service/Ingress/NetworkPolicy/HPA/ConfigMap block was edited. `kubectl kustomize infrastructure/k8s` was run before and after to confirm the existing 4 workloads' manifests are byte-for-byte unchanged aside from the new storefront blocks appended after them.

## Verification Results

| Gate                                   | Result                                                                                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                       | ✅ 76/76 tasks (all cache-hit — no TS source changed)                                                                                                                                             |
| `pnpm lint`                            | ✅ 76/76 tasks (all cache-hit)                                                                                                                                                                    |
| `pnpm turbo run test --concurrency=1`  | ✅ 76/76 tasks, 30 test files / 145 tests passed (runtime suite, uncached, re-ran live)                                                                                                           |
| `pnpm arch`                            | ✅ 0 dependency violations (1531 modules, 6676 dependencies cruised)                                                                                                                              |
| `pnpm build`                           | ✅ storefront builds; confirmed `/` is `ƒ` (server-rendered per request), not statically cached — the new `/` health probe actually exercises a live request each time, not a build-time snapshot |
| `kubectl kustomize infrastructure/k8s` | ✅ builds cleanly, all storefront resources present (ConfigMap, Deployment, Service, HPA, PDB, 3× NetworkPolicy, Ingress)                                                                         |

### Runtime Evidence

**Static manifest verification only.** Docker Desktop was confirmed broken again in this sandbox before starting (`docker info` → `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`), the same standing, previously-reported fact from [[lumo-integration-verification-sprint]] and [[lumo-m2-2-media-storage-remediation]] — not re-litigated, just re-confirmed. No container was built, no pod was scheduled, no `/` response was actually observed. What **was** verified for real:

- `kubectl kustomize` (client-side kustomize build, no cluster needed) succeeds and emits syntactically valid manifests with the storefront resources correctly cross-referenced (Service selector matches Deployment labels, Ingress backend matches Service name/port, ConfigMap name matches the Deployment's `envFrom`).
- `pnpm build` proves the image's `builder` stage input (the actual `next build` output the Dockerfile copies from) is currently buildable and produces the expected `output: "standalone"` artifacts with `/` as a dynamic route.

No claim of "container boots" / "health endpoint returns healthy" / "ingress routing works" / "runtime reaches Ready state" is made — those require a live cluster this sandbox does not have.

## Regression Tests

None added — this is a pure infrastructure/deployment change with no new application logic to unit-test. The existing `pnpm arch`/`typecheck`/`lint`/`test` suite (unchanged, all green) is the correct regression surface for a change with zero application source diff.

## Residual / Known Gaps (not this finding's scope)

- **CSP for the storefront Ingress** — intentionally left undefined per `SECURITY_HARDENING.md`'s own guidance; needs dedicated nonce-based middleware work.
- **`release.yml`/`deploy.yml` don't yet cover collector OR storefront** beyond the image build — signing (`release.yml`) and the rollout-wait list / `kustomize edit set image` (`deploy.yml`) only mention the runtime image today. This is a pre-existing gap shared with collector (H-07), not introduced or worsened by this sprint.
- **`web.Dockerfile` has no `tini` init** (unlike `runtime.Dockerfile`/`collector.Dockerfile`) — a pre-existing characteristic of the image, not modified here.
- **No dedicated `/healthz`/`/readyz`** for the storefront — probes use `/`, matching the image's own established convention; worth revisiting once the app gains real routes.

## Commit

One commit, 7 files (2 new + 5 edited): `.github/workflows/build.yml`, `infrastructure/k8s/{27-storefront-config.yaml (new), 28-deployment-storefront.yaml (new), 30-services.yaml, 40-autoscaling.yaml, 50-networkpolicy.yaml, 60-ingress.yaml, kustomization.yaml}`.

The four pre-existing untracked reports from the Medium Verification sprint (`MEDIUM_REMEDIATION_PLAN.md`, `MEDIUM_VERIFICATION_REPORT.md`, `POST_CRITICAL_VERIFICATION_REPORT.md`, `V1_FINAL_VERIFICATION.md`) predate this sprint's scope and were left untouched and uncommitted, per the standing sprint-isolation discipline.
