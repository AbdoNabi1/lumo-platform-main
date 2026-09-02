# H-07 — Collector readiness is unconditionally healthy, and the collector is not deployed at all

| Field                      | Value                                                                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**               | High                                                                                                                                                            |
| **Area**                   | Reliability / Deployment / Tracking                                                                                                                             |
| **Baseline**               | `main` @ `756bce3`                                                                                                                                              |
| **Blocker verdict**        | **True blocker** for the tracking product. Two distinct defects: an empty health registry (an oversight) and a missing deployment (file loss / never authored). |
| **Public contract change** | **No.**                                                                                                                                                         |

---

## 1. Location

| File                                    | Lines   | What is there                                                          |
| --------------------------------------- | ------- | ---------------------------------------------------------------------- |
| `apps/collector/src/main.ts`            | 67      | `const health = new HealthRegistry();` — **no `.register()` anywhere** |
| `apps/collector/src/server.ts`          | 41–44   | `/readyz` runs that empty registry                                     |
| `apps/collector/src/main.ts`            | 62–65   | `publisher.connect()` at boot — the only Kafka liveness signal         |
| `apps/runtime/src/composition.ts`       | 121–128 | The contrasting, correct pattern (Postgres + Redis probes registered)  |
| `infrastructure/k8s/kustomization.yaml` | 7–17    | Ten resources — **no collector Deployment or Service**                 |
| `apps/collector/package.json`           | 12–17   | Scripts — `start: tsx src/main.ts`; no build, no image                 |
| `.github/workflows/ci.yml`              | —       | No collector-specific job (it is covered only by `turbo run test`)     |

**Absent from `main`, present in `de46df9`:** `apps/runtime/src/health-server.ts` (the reusable non-Fastify health surface these processes need).

---

## 2. Current implementation

### 2a. An empty health registry

```ts
// apps/collector/src/main.ts:67
const health = new HealthRegistry();
```

That is the only reference to `health` other than passing it to the server. No probe is registered.

```ts
// apps/collector/src/server.ts:40-44
app.get("/healthz", async () => ({ status: "ok" }));
app.get("/readyz", async (_request, reply) => {
  const report = await deps.health.run();
  return reply.status(report.status === "unhealthy" ? 503 : 200).send(report);
});
```

`health.run()` over an empty registry cannot report `unhealthy`. `/readyz` returns **200 with an empty component list, always**.

The contrast with the runtime is stark — `apps/runtime/src/composition.ts:121-128` does it correctly:

```ts
const health = new HealthRegistry();
health.register({
  name: "postgres",
  probe: async () => {
    await prisma.$queryRawUnsafe("SELECT 1");
  },
});
health.register(redis.healthCheck());
```

### 2b. Kafka is checked exactly once, at boot

```ts
// apps/collector/src/main.ts:62-65
const publisher = new KafkaMessageProducer(kafka);
// Connect at boot: a broker that is unreachable should fail the deploy, not surface as a 503 on
// the first real visitor.
await publisher.connect();
```

This is good reasoning and the right boot behaviour. But it is a one-time check. A broker that becomes unreachable _after_ boot is never re-detected by readiness.

### 2c. The collector is not deployed

```yaml
# infrastructure/k8s/kustomization.yaml:7-17
resources:
  - 00-namespace.yaml
  - 10-config.yaml
  - 20-deployment-api.yaml
  - 21-deployment-worker.yaml
  - 22-deployment-scheduler.yaml
  - 30-services.yaml
  - 40-autoscaling.yaml
  - 50-networkpolicy.yaml
  - 60-ingress.yaml
  - 70-debezium.yaml # P2.0.1: production CDC (outbox → Kafka)
```

No collector Deployment, Service, HPA, Ingress rule, or NetworkPolicy entry. There is no `collector.Dockerfile` (C-02 applies — the only Dockerfile builds the storefront), and `apps/collector/package.json` has no `build` script.

---

## 3. Why it is incorrect

Two independent defects with one shared consequence.

**(a) A readiness probe that cannot fail is not a readiness probe.** Kubernetes uses `/readyz` to decide whether to route traffic. An endpoint hardcoded to succeed converts readiness gating into a no-op. The pattern to follow already exists twelve files away in the same repository (`apps/runtime/src/composition.ts:121-128`), and the `HealthRegistry` API is identical — this is an omission, not a design difference.

**(b) An application with no deployment artefact is not deployable.** Every prerequisite the collector needs is present — package, entrypoint, composition root, tests — but nothing packages or schedules it. Note this is _not_ the same as C-02: the runtime at least has a preserved Dockerfile in `de46df9`; the collector has never had one.

The two compound: even once (a) is fixed, the probe cannot help because there is nothing running to probe.

---

## 4. Production impact

**(a) Traffic routed to a pod that 503s every beacon.** If the collector were deployed and Kafka became unreachable, `CollectorEndpoint.handle` catches the publish failure and correctly returns 503 (`collector-endpoint.ts:117-139`) — good behaviour, and its reasoning is right: _"Telling the browser 'accepted' when the event never reached the bus loses it permanently and invisibly."_ But `/readyz` keeps returning 200, so Kubernetes keeps the pod in the Service endpoints and keeps sending it traffic. Every beacon 503s; nothing self-heals; no rollback is triggered. The safety property the 503 was designed to provide — _the SDK retries_ — is undermined by retrying against the same permanently-broken pod.

**(b) The tracking ingress does not exist in the target cluster.** `kubectl apply -k infrastructure/k8s` deploys api, worker, scheduler, and Debezium. No collector. Therefore:

- No browser beacon can reach the platform.
- Combined with **C-07** (nothing consumes `tracking.event.captured.v1`), the tracking platform has **neither a producer nor a consumer** in production. Both halves of the pipeline are absent for different reasons.
- Fixing C-07 alone would produce a correctly-wired consumer subscribed to a topic that receives nothing.

**(c) The collector's own counters are unreachable.** `CollectorEndpoint.counters()` (`collector-endpoint.ts:67-74`) tracks `received` / `published` / `refused` / `publishFailed` — described as _"Counters so operational validation can assert the collector ran, not infer it from silence."_ Exactly the right instinct, and nothing exposes them: `createCollectorServer` registers only `/healthz`, `/readyz`, `/collect`. There is no `/metrics`.

---

## 5. Smallest additive fix

Three changes; the first two are small.

### Step 1 — register real readiness probes (~8 lines)

```ts
// apps/collector/src/main.ts, after `const health = new HealthRegistry();`
health.register({
  name: "kafka",
  probe: async () => {
    const admin = kafka.admin();
    await admin.connect();
    try {
      await admin.listTopics();
    } finally {
      await admin.disconnect();
    }
  },
});
```

If `@platform/kafka` already exposes a health check (as `@platform/redis` does via `redis.healthCheck()`, used at `apps/runtime/src/composition.ts:128`), prefer that — reuse over a bespoke probe. Check `packages/kafka/src/index.ts` first.

### Step 2 — expose the existing counters at `/metrics` (~10 lines)

`CollectorEndpoint.counters()` already returns the four numbers. Add a `/metrics` route to `createCollectorServer` rendering them as Prometheus counters (`collector_events_received_total`, `_published_total`, `_refused_total`, `_publish_failed_total`). This pairs with **H-04**; consider reusing the `renderMetric` helper from the `metrics.ts` restored there rather than writing a second renderer.

Note `apps/runtime/src/health-server.ts` in `de46df9` is a _framework-free_ health+metrics surface built for exactly this shape of process — worth reading before writing anything new, though the collector already has Fastify so it does not need it.

### Step 3 — package and deploy it (the substantive part)

1. **A collector image.** The runtime Dockerfile restored in C-02 is a `pnpm install` + `tsx` entrypoint image parameterised by `WORKDIR` and `CMD`. The cheapest correct move is to reuse it with a different `WORKDIR /app/apps/collector` and `CMD ["node","--import","tsx","src/main.ts"]`, rather than authoring a second near-identical Dockerfile — the same Rule-of-Three reasoning that file already applies to api/worker/scheduler.
2. **`infrastructure/k8s/23-deployment-collector.yaml`**, modelled on `20-deployment-api.yaml` (same security context, probes, topology spread, `preStop` drain), plus a Service entry, an Ingress rule for the public `/collect` path, and a NetworkPolicy allowing ingress from the internet and egress to Kafka only.
3. **Required env**, all already validated at boot by `main.ts:21-52`: `COLLECTOR_WRITE_KEYS`, `COLLECTOR_ALLOWED_ORIGINS`, `KAFKA_BROKERS`, and optionally `COLLECTOR_TRUSTED_PROXIES`, `COLLECTOR_SECURE_COOKIES`, `COLLECTOR_COOKIE_DOMAIN`.
4. **Set `COLLECTOR_TRUSTED_PROXIES` deliberately.** It defaults to `0`, and `main.ts:35-37` explains why: _"a wrong non-zero value makes the client IP attacker-controlled."_ Behind an Ingress it must match the real hop count — this is a security-relevant deployment decision, not a default to accept.
5. **Rate limiting.** `apps/collector/src/server.ts:6-14` states that beacon rate limiting _"belongs at the CDN edge"_. That is defensible, but `edge/` on `main` contains only a `README.md`. Either add rate limiting at the Ingress or accept an unthrottled public endpoint knowingly.

---

## 6. Public contract impact

**None.**

- Registering health probes changes the _content_ of the `/readyz` body (it gains component entries) but not its shape, status codes, or path. `HealthRegistry` and `HealthReport` (`@platform/health`) are unchanged.
- `/metrics` is a new route on the collector server. `/collect` and `/healthz` are untouched — no change to the beacon contract, cookie behaviour, CORS handling, or response codes.
- Deployment manifests and Dockerfiles are build/runtime configuration, not code contracts.

---

## 7. Blocker or intentional deferral?

**True blocker for tracking, and not a documented deferral.**

`docs/KNOWN_GAPS.md` contains no gap for "collector not deployed" or "collector readiness unwired". The collector is a fully-realised application: 8 source files, 13 passing tests, a composition root whose header insists _"Every dependency is real. There is no in-memory publisher fallback and no permissive default"_ (`main.ts:4-7`). It was built to be run.

The empty `HealthRegistry` is a plain oversight — the correct pattern exists in the sibling app and was not applied here.

The missing deployment is more consequential: it means the collector has **never been deployed anywhere**, consistent with C-09 (the platform has never booted). Together with C-07, it means neither end of the tracking pipeline exists in the target cluster.

**Verdict: true blocker** for any deployment that claims tracking works. If tracking is explicitly descoped for the first release, this drops to Medium — but that descoping must be stated, because nothing in the repository says it today.

---

## 8. How this was verified

- `apps/collector/src/main.ts` read in full (112 lines) — `new HealthRegistry()` at line 67, no `.register()` call in the file.
- `apps/collector/src/server.ts` read in full (141 lines) — three routes: `/healthz`, `/readyz`, `/collect` (+ `OPTIONS`).
- `apps/collector/src/collector-endpoint.ts` read in full (178 lines) — `counters()` at 67–74, unexposed.
- `apps/collector/package.json` read — no `build` script.
- `infrastructure/k8s/kustomization.yaml` read in full — 10 resources, no collector.
- `Get-ChildItem -Recurse -Filter "*ockerfile*"` (excluding `node_modules`) → 1 file (storefront).
- `apps/runtime/src/composition.ts:121-128` read for the correct probe-registration pattern.
- `git ls-files edge` → `edge/README.md` only.
- No code was modified.
