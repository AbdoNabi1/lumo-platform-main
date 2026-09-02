# C-09 — The platform has never been booted; the identity stack it requires has no configuration on `main`

| Field                      | Value                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**               | Critical                                                                                                                                                |
| **Area**                   | Operations / Validation                                                                                                                                 |
| **Baseline**               | `main` @ `756bce3`                                                                                                                                      |
| **Blocker verdict**        | **True blocker.** Tracked as G-41 and honestly reported as blocked — but a system whose first execution is its production deployment is not deployable. |
| **Public contract change** | **No.**                                                                                                                                                 |

---

## 1. Location

| File                                        | Reference | What it says                                                                                           |
| ------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------ |
| `docs/KNOWN_GAPS.md`                        | G-41      | _"First live boot"_ — status **`blocked-on-operator`**, priority **P0**, impact _"everything runtime"_ |
| `docs/KNOWN_GAPS.md`                        | G-39      | _"api serves in-memory data"_ — **`open`**, P1                                                         |
| `docs/implementation/SPRINT_3_0B_REPORT.md` | 3         | _"**Outcome: BLOCKED AT STEP 1 — honestly.** Nothing was faked; no validation is [claimed]"_           |
| `docs/implementation/SPRINT_3_0B_REPORT.md` | 8–13      | Docker Desktop engine never came up; `Start-Service com.docker.service` → access denied                |
| `packages/db/prisma/MIGRATIONS.md`          | §1        | The init migration _"has **not** run against a real database yet"_                                     |
| `packages/kafka/src/consumer-runtime.ts`    | 95        | `allowAutoTopicCreation: false`                                                                        |
| `infrastructure/docker/docker-compose.yml`  | —         | 20 services; **no `kratos`, `keto`, or `hydra`**                                                       |
| `apps/runtime/src/config.ts`                | 143–152   | Requires `KETO_WRITE_URL`, `KRATOS_PUBLIC_URL`, `KRATOS_ADMIN_URL` outside `local`                     |

**Absent from `main`, present in `de46df9`:**

```
infrastructure/docker/docker-compose.runtime.yml
infrastructure/docker/kratos/kratos.yml
infrastructure/docker/kratos/identity.schema.json
infrastructure/docker/keto/keto.yml
infrastructure/docker/hydra/hydra.yml
infrastructure/ory/keto.yml
.github/workflows/ory-integration.yml
```

---

## 2. Current implementation

### 2a. The boot was attempted once and blocked on the environment, not the code

`docs/implementation/SPRINT_3_0B_REPORT.md` records the attempt with unusual candour:

> _"Outcome: BLOCKED AT STEP 1 — honestly. Nothing was faked; no validation is [claimed]."_
> _"`Start-Process "Docker Desktop.exe"` → app launched, engine polled every 10s for 8 minutes total → `docker info` never connected."_
> _"Diagnostics: WSL2 healthy … zero docker processes resident after launch."_
> _"`Start-Service com.docker.service` → access denied (service ACL requires elevation)."_

G-41 has remained `blocked-on-operator` since.

### 2b. Every downstream validation is therefore unexecuted

- **Migrations.** `packages/db/prisma/MIGRATIONS.md` §1: the initial migration _"was generated **offline** with `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema --script` (this environment has no database host). It has **not** run against a real database yet — the first Docker-host session must run `prisma migrate deploy` against a fresh Postgres 16 and fix any drift before anything else builds on it."_ That drift is exactly C-04.
- **Integration tests.** All 9 `*.integration.test.ts` files gate on `DATABASE_URL_TEST`; `pnpm test` in this working tree reported **70 skipped** (56 customer-360, 6 security, 3 orders, plus Redis/Kafka/S3). See H-09.
- **Kafka topics.** `packages/kafka/src/consumer-runtime.ts:95` sets `allowAutoTopicCreation: false`. Topics must pre-exist. `infrastructure/docker/redpanda/bootstrap-topics.sh` creates them for the compose stack only — nothing in `infrastructure/k8s/` does. No topic has ever been created.
- **CDC.** `infrastructure/k8s/70-debezium.yaml` has never been applied; the `lumo_outbox` replication slot and `lumo_outbox` publication have never existed. `infrastructure/docker/postgres/init/01-roles-and-cdc.sql` has never run.

### 2c. The identity stack the runtime requires cannot be started from `main`

`apps/runtime/src/config.ts:143-152` fails composition outside `local` without the full Ory triad:

```ts
for (const key of ["KETO_WRITE_URL", "KRATOS_PUBLIC_URL", "KRATOS_ADMIN_URL"] as const) {
  if (cfg.APP_ENV !== "local" && cfg[key] === undefined) {
    ctx.addIssue({ ..., message: `${key} is required unless APP_ENV=local (Ory identity binding, H-2).` });
  }
}
```

and `apps/runtime/src/composition.ts:89-93` additionally requires `AUTH_ISSUER_URL` + `AUTH_JWKS_URL`.

`infrastructure/docker/docker-compose.yml` on `main` defines 20 services — postgres, redis, clickhouse, minio, redpanda, debezium, apicurio, otel-collector, prometheus, loki, tempo, grafana, mailpit, pgadmin, redisinsight, web, and support containers — **and no Kratos, Keto, or Hydra.** Their configuration directories are absent from `main` and present in `de46df9`.

There is also no `docker-compose.runtime.yml` on `main`, so the compose stack brings up dependencies but not the api/worker/scheduler processes.

---

## 3. Why it is incorrect

Not a code defect — an **evidence** defect. Every runtime claim in this repository is currently unfalsified rather than verified:

1. Migrations were generated by `prisma migrate diff` from an empty schema and never applied. Offline generation cannot detect the 36-table gap C-04 identifies.
2. `readyz` health probes, graceful shutdown, `preStop` drain, HPA behaviour, rolling-update semantics, and probe timings have never been observed.
3. Debezium's `EventRouter` transform has never processed a real outbox row. The field mappings look correct on inspection, but `value.converter: io.debezium.converters.BinaryDataConverter` over a `Bytes` payload column is exactly the kind of thing that is right on paper and wrong in practice.
4. `KafkaConsumerRuntime`'s retry-topic behaviour — including the head-of-line defect in H-05 — has never been observed against a real broker. H-05 was found by reading `consumer.run` options, not by watching a stall.
5. The four Prisma-backed contexts' repositories have never executed a query.

The G-41 blocker is real and environmental (Docker Desktop requiring elevation on the author's Windows host). **But CI does not have that constraint.** GitHub-hosted runners provide Docker and service containers natively, and `de46df9` contains a `db-integration.yml` that already uses `postgres:16` as a service. The boot has been blocked on a laptop while a working CI path sat one `git checkout` away.

---

## 4. Production impact

**A production deployment would be this system's first execution, ever.**

Concretely, the first boot would hit, in order:

1. `ErrImagePull` — no runtime image exists (C-02).
2. If an image were built by hand: `loadRuntimeConfig()` throws unless the Ory triad is configured — and no Kratos/Keto/Hydra deployment or configuration exists on `main` (§2c). There is no `infrastructure/k8s` manifest for them either.
3. If Ory were stood up out-of-band: `prisma migrate deploy` succeeds while leaving 36 tables uncreated (C-04).
4. Consumers fail to subscribe — topics do not exist (`allowAutoTopicCreation: false`).
5. Debezium fails — the `lumo_outbox` publication and replication slot do not exist.
6. If all of that were resolved, the API would serve in-memory data (C-01) with no metrics (H-04), no traces (H-10), and an in-memory audit trail (H-01).

There is no partial-credit path here. The unknowns are not "will performance be acceptable" — they are "will any of this start".

---

## 5. Smallest additive fix

**Do not attempt the first boot on a developer laptop. Do it in CI, where the environmental blocker does not exist.**

### Step 1 — restore the stack definitions (purely additive)

```bash
git checkout de46df9 -- \
  infrastructure/docker/docker-compose.runtime.yml \
  infrastructure/docker/kratos \
  infrastructure/docker/keto \
  infrastructure/docker/hydra \
  infrastructure/ory \
  .github/workflows/ory-integration.yml
```

Then confirm the restored Ory services are referenced from `infrastructure/docker/docker-compose.yml` (they may need to be re-added to the service list, since `main`'s compose file has no Ory services today).

### Step 2 — restore `db-integration.yml` and let CI perform the first boot (see C-03, H-09)

`de46df9`'s `db-integration.yml` already provisions `postgres:16` as a service container with both `DATABASE_URL` and `DATABASE_URL_TEST` set. Restoring it delivers, in one commit:

- the first real `prisma migrate deploy`,
- the first execution of all 9 integration suites (70 currently-skipped tests),
- a migration-drift gate that would have caught C-04.

**This is the single highest-value action in the entire remediation plan.** It converts C-09 from "blocked on an operator's GUI" into "runs on every push".

### Step 3 — extend to a full stack smoke test

Once Step 2 is green, add Redpanda + Debezium service containers and one end-to-end assertion: write an aggregate → confirm an outbox row → confirm the message lands on the Kafka topic → confirm the consumer marks it processed. That single test validates ADR-0003, ADR-0005, the CDC field mappings, and C-08 simultaneously.

### Step 4 — only then attempt a cluster deploy

Prerequisites: C-02 (image), C-03 (pipeline), C-04 (migrations), plus k8s manifests for the Ory stack and a topic-bootstrap Job, neither of which exists in `infrastructure/k8s/` today.

---

## 6. Public contract impact

**None.** Every change is infrastructure configuration, CI definition, and test execution. No TypeScript signature, HTTP route, event schema, or package export is touched.

---

## 7. Blocker or intentional deferral?

**A true blocker that has been correctly and honestly reported as one.**

This finding deserves credit rather than criticism for how it is documented. `SPRINT_3_0B_REPORT.md` opens with _"BLOCKED AT STEP 1 — honestly. Nothing was faked; no validation is [claimed]"_, and `MIGRATIONS.md` §1 states in plain terms that the initial migration has never run. The team did not paper over the gap; `docs/KNOWN_GAPS.md` rates G-41 **P0** and assigns it to the operator.

What has been missed is that the blocker is **environmental, not technical**, and CI removes it. G-41's "Blocked by" column reads _"STABLE engine (attempt #2: engine up → crashed during first pull …)"_ — a local Docker Desktop problem. GitHub Actions service containers make that irrelevant, and the workflow to use them was already written and is sitting in `de46df9`.

**Verdict: true blocker — and the cheapest one to unblock.** Everything else in this audit is either verified-by-reading (which cannot substitute for execution) or unverifiable until this closes.

---

## 8. How this was verified

- `docs/KNOWN_GAPS.md` read in full — G-41 and G-39 quoted verbatim.
- `docs/implementation/SPRINT_3_0B_REPORT.md` lines 3–13 read.
- `packages/db/prisma/MIGRATIONS.md` §0–§1 read.
- `pnpm test` executed → **76/76 tasks pass, 70 tests skipped**, all infrastructure-gated.
- All 9 `*.integration.test.ts` files confirmed to gate on `process.env["DATABASE_URL_TEST"]`.
- `packages/kafka/src/consumer-runtime.ts:93-98` read — `allowAutoTopicCreation: false`.
- `infrastructure/docker/docker-compose.yml` service list enumerated — no Ory services.
- File-set diff `de46df9` vs `main` → `kratos/`, `keto/`, `hydra/`, `infrastructure/ory/`, `docker-compose.runtime.yml`, `ory-integration.yml` all absent from `main`.
- `git show de46df9:.github/workflows/db-integration.yml` read — confirms a working `postgres:16` service-container path.
- No code was modified.
