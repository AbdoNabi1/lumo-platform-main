# HIGH-06 — Tracking Topic Provisioning

**Source finding:** `H2-5` in `FINAL_PRODUCTION_READINESS_AUDIT_v2.md` — _"The tracking topic is never
created, and ingest is disabled with no way to enable it."_
**Type:** Remediation. Infra/config changed, no application code changed. **Public contract impact:
none.**

---

## 1. Investigate

- `infrastructure/docker/redpanda/bootstrap-topics.sh` — creates 18 business topics with `.retry`/`.dlq`
  companions via `with_companions`. `tracking.event.captured.v1` was **not** among them.
- `packages/kafka/src/consumer-runtime.ts` — `allowAutoTopicCreation: false`; the ingest consumer
  (`apps/runtime/src/tracking/tracking-ingest.ts`, wired via `buildTrackingIngestRuntime`) would fail to
  subscribe if the topic does not exist.
- `apps/runtime/src/config.ts:46-59` — `TRACKING_INGEST_ENABLED` (default `off`), `TRACKING_RULE_SET_KEY`,
  `TRACKING_REGISTRY_POLL_MS` all exist with safe defaults.
- `infrastructure/k8s/10-config.yaml` — set none of the three `TRACKING_*` keys, so they were invisible
  in the deployment manifest even though `config.ts` documents them as the activation path.
- `docs/architecture/20-events-catalog.md` §5 — `tracking.event.captured.v1` is already documented with
  its retention (13mo), priority (high), and consumers (Analytics, Attribution, Conversion forwarder) —
  the authoritative source for the value used below.

**Impact (as the audit found and this re-confirms by reading, not assuming):** two compounding failures.
With the shipped config, ingest is never enabled (config default `off`), so the pipeline stays inert —
the exact silent-loss condition C-07 was built to remove, reintroduced by configuration. If an operator
sets the flag without this fix, the consumer then fails to subscribe because the topic does not exist.

## 2. Prove

These are infrastructure files (shell + YAML), outside the TypeScript build graph `pnpm typecheck`/
`lint`/`test`/`arch` cover — there is no existing test harness in this repository for `.sh`/k8s-manifest
content (confirmed: no test file references `bootstrap-topics.sh` or `10-config.yaml`), so introducing
one here would be new testing infrastructure disproportionate to a topic-list addition. Verified instead
by direct inspection: the added `with_companions` line is byte-for-byte the same shape (`create` + `.retry`

- `.dlq`) as the other 18 entries in the same file, and the added ConfigMap keys are read-back verified to
  match `config.ts`'s existing defaults exactly (so nothing changes until an operator edits them).

## 3. Implement

`infrastructure/docker/redpanda/bootstrap-topics.sh` — added
`with_companions tracking.event.captured.v1 6 "$RET_13MO"`, same convention as every other business
topic in the file (6 partitions, `.retry`/`.dlq` companions), retention taken from the events catalog.

`infrastructure/k8s/10-config.yaml` — added the three `TRACKING_*` keys, with values matching `config.ts`'s
own defaults (`TRACKING_INGEST_ENABLED: "false"`, `TRACKING_RULE_SET_KEY: "tracking.routing.default"`,
`TRACKING_REGISTRY_POLL_MS: "30000"`) — **this changes no current behaviour**, it makes a previously
invisible gate visible and discoverable in the deployment manifest. `TRACKING_INGEST_ENABLED` is
deliberately left `"false"` here rather than flipped to `"true"`: the audit's own recommended action states
the sequencing explicitly — _"topic first, registry seed second, flag last — `loadTrackingRegistry` will
refuse to start against an unseeded registry, which is correct."_ Registry seeding is a live-infrastructure
operational step this commit cannot perform; flipping the flag first in the checked-in manifest would
crash-loop the worker in a real cluster the moment this topic-and-config fix is deployed, which is exactly
the class of self-inflicted outage this sprint's guardrail fixes (H-01) exist to prevent elsewhere.

## 4. Run

| Gate             | Result                                                  |
| ---------------- | ------------------------------------------------------- |
| `pnpm typecheck` | ✅ 76/76 (unaffected — infra files only)                |
| `pnpm lint`      | ✅ 76/76 (unaffected — infra files only)                |
| `pnpm test`      | ✅ 76/76 (unaffected — infra files only)                |
| `pnpm arch`      | ✅ no dependency violations (1,531 modules, 6,672 deps) |

## 5. Scope discipline

No architecture change, no new bounded context, no public API change, no application code touched. The
topic-creation script and the deployment ConfigMap are the only two files changed, matching the audit's
exact recommended action. Enabling ingest for real remains a separate operational step (seed the registry,
then flip one flag) outside this sprint's code-change scope.
