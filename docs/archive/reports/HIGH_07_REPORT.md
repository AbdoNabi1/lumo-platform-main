# HIGH-07 — Collector Deployment & Health

**Source finding:** `H2-6` in `FINAL_PRODUCTION_READINESS_AUDIT_v2.md` — _"The collector is not
deployable and its readiness probe cannot fail."_
**Type:** Remediation. Code + infra changed. **Public contract impact:** `KafkaMessageProducer` gains
one additive getter (`isConnected`); no existing method signature changed.

---

## 1. Investigate

- `apps/collector/src/main.ts:67` (before this change) — `const health = new HealthRegistry();` with
  **no `health.register(...)` call anywhere** in `apps/collector`. `/readyz`
  (`apps/collector/src/server.ts:41-44`) reports whatever `health.run()` returns, which with zero
  registered checks is unconditionally healthy.
- `infrastructure/docker/` — `runtime.Dockerfile` builds api/worker/scheduler; `web.Dockerfile` builds
  the storefront. **No collector Dockerfile.**
- `infrastructure/k8s/` — no collector Deployment, Service, or Ingress.
- `.github/workflows/build.yml` — built exactly one image (the runtime).

**Impact confirmed by reading:** the collector is the public ingress for the entire tracking product —
undeployable, and even run manually its readiness probe could never fail, so a pod whose Kafka producer
had died would keep receiving traffic it could not publish.

## 2. Implement — code (closes "readiness probe cannot fail")

- `packages/kafka/src/producer.ts` — `KafkaMessageProducer` gains an `isConnected` getter and now
  registers a listener on the kafkajs producer's own `DISCONNECT` event, so the flag reflects a
  broker-side drop, not just "was `connect()` called once." Purely additive; every existing method is
  unchanged.
- `apps/collector/src/main.ts` — registers a `"kafka-producer"` health check (`probe` throws when
  `publisher.isConnected` is false), same shape as the postgres/redis checks already registered in
  `apps/runtime/src/composition.ts:151-157`.

**Prove:** new `packages/kafka/src/producer.test.ts` (no existing test covered this class) — asserts
`isConnected` is false before `connect()`, true after, false after an explicit `disconnect()`, **and**
false when a fake kafkajs producer emits its `DISCONNECT` event without any `disconnect()` call — the
exact broker-drop case a naive "did we ever connect" flag would miss.

## 3. Implement — deployability (closes "not deployable")

- `infrastructure/docker/collector.Dockerfile` (new) — same builder pattern as `runtime.Dockerfile`
  (frozen-lockfile install, non-root, tini PID 1, image-level `/healthz` `HEALTHCHECK`), targeting
  `apps/collector`'s own entrypoint and port (3200).
- `infrastructure/k8s/25-collector-config.yaml` (new) — non-secret env (`PORT`, `KAFKA_BROKERS`,
  `COLLECTOR_ALLOWED_ORIGINS`, `COLLECTOR_TRUSTED_PROXIES`, `COLLECTOR_SECURE_COOKIES`).
- `infrastructure/k8s/26-deployment-collector.yaml` (new) — same security posture as
  `20-deployment-api.yaml` (non-root, dropped capabilities, read-only rootfs, topology spread,
  startup/liveness/**readiness** probes — readiness now backed by the real check above).
- `infrastructure/k8s/30-services.yaml` — added the `collector` ClusterIP Service.
- `infrastructure/k8s/60-ingress.yaml` — added a collector Ingress (`/collect` only; no CORS annotation,
  since the collector already resolves the allow-listed origin itself — two sources of truth for
  allowed origins would drift).
- `infrastructure/k8s/40-autoscaling.yaml` — added collector HPA (CPU, 2-10 replicas) + PDB
  (`minAvailable: 1`), same shape as `runtime-api`.
- `infrastructure/k8s/50-networkpolicy.yaml` — added an ingress-only `NetworkPolicy` scoped to the
  collector's pod selector and its own port (3200, distinct from the runtime's 3080). Egress (Kafka,
  DNS) is already covered by the existing blanket `podSelector: {}` policies.
- `infrastructure/k8s/secret.example.yaml` — added the `lumo-collector-secrets` template
  (`COLLECTOR_WRITE_KEYS`), same provisioning convention as `lumo-runtime-secrets`.
- `infrastructure/k8s/kustomization.yaml` — added the two new collector files so
  `kubectl apply -k infrastructure/k8s` deploys the collector alongside the runtime.
- `.github/workflows/build.yml` — added a `collector-image` job, mirroring the existing `image` job
  exactly (same auth, same attestations), with its own `collector_image`/`collector_digest` outputs.

**Prove (infra):** no existing test harness in this repository parses `.sh`/k8s-manifest/workflow YAML
(same situation as `HIGH_06`). Verified instead by loading every changed/added YAML file (and
`build.yml`) through `js-yaml` and confirming each parses with the expected document count per file
(e.g. `30-services.yaml` went from 3 to 4 documents, `40-autoscaling.yaml` from 5 to 7,
`50-networkpolicy.yaml` from 5 to 6, `60-ingress.yaml` from 1 to 2, `secret.example.yaml` from 1 to 2) —
this is a real syntax check, not a visual read.

## 4. Deliberately NOT done (documented gap, not silently dropped)

`.github/workflows/deploy.yml` and `release.yml` are **not** changed. `deploy.yml` is a manually
dispatched workflow built around a single `image_digest` input, driving one `kustomize edit set image`
call, one Trivy scan, one cosign verification, and one rollout-status/rollback loop. Extending it to
handle a second, independently-digested image is a real expansion of that pipeline's shape (a new
required input, a duplicated scan/sign/verify path, two rollout targets) — bigger than what one High
finding should carry, and riskier to get right without the ability to actually exercise a deploy in this
environment. `release.yml` similarly signs and publishes only the runtime digest today. The collector
image now **builds** in CI (closing the literal "nothing builds one" complaint) and is deployable via
`kubectl apply -k .` using whatever tag is pinned in `26-deployment-collector.yaml`
(`lumo-collector:local`, same placeholder convention `runtime.Dockerfile`'s manifest uses before a real
deploy pins a digest) — wiring the collector into the digest-pinned release/deploy pipeline is future
work, not a wiring gap this commit leaves lying about anything.

## 5. Run

| Gate             | Result                                                     |
| ---------------- | ---------------------------------------------------------- |
| `pnpm typecheck` | ✅ 76/76                                                   |
| `pnpm lint`      | ✅ 76/76                                                   |
| `pnpm test`      | ✅ 76/76 tasks; `@platform/kafka` 12 tests (was 9, +3 new) |
| `pnpm arch`      | ✅ no dependency violations (1,531 modules, 6,672 deps)    |

## 6. Scope discipline

No architecture change, no new bounded context, no public API change beyond one additive getter. No
existing Dockerfile, Deployment, Service, or CI job was modified — every change is either a new file or
an additive append (`---`-separated new resource, new workflow job) to an existing one.
