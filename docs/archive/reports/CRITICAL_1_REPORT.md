# CRITICAL-1 REPORT — Runtime boot failure (missing Ory identity URLs)

**Finding closed:** C2-1, `FINAL_PRODUCTION_READINESS_AUDIT_v2.md`
**Type:** Deployment/runtime configuration fix only. No business logic changed.

## Investigate

`infrastructure/k8s/10-config.yaml` sets `APP_ENV: "production"`. `apps/runtime/src/config.ts:164-172`
requires `KETO_WRITE_URL`, `KRATOS_PUBLIC_URL`, and `KRATOS_ADMIN_URL` whenever `APP_ENV !== "local"`:

```ts
for (const key of ["KETO_WRITE_URL", "KRATOS_PUBLIC_URL", "KRATOS_ADMIN_URL"] as const) {
  if (cfg.APP_ENV !== "local" && cfg[key] === undefined) {
    ctx.addIssue({ ... message: `${key} is required unless APP_ENV=local (Ory identity binding, H-2).` });
  }
}
```

None of the three keys appeared in `10-config.yaml`, `secret.example.yaml`, or any `env:` block in
`20-deployment-api.yaml` / `21-deployment-worker.yaml` / `22-deployment-scheduler.yaml` — env for all
three Deployments comes exclusively from `envFrom: [configMapRef, secretRef]`.

## Prove

Wrote a probe (`scratchpad/probe-config.ts`, not part of the repo) that **parses the actual YAML files
off disk** — `10-config.yaml`'s `data:` block and `secret.example.yaml`'s `stringData:` block — builds
an env from exactly those parsed key/value pairs (no manual transcription), and passes it to the real
`loadRuntimeConfig()` from `@platform/runtime`.

**Before the fix:**

```
RESULT: BOOT FAILURE
Error: Invalid runtime configuration: KETO_WRITE_URL: KETO_WRITE_URL is required unless APP_ENV=local
(Ory identity binding, H-2).; KRATOS_PUBLIC_URL: ...; KRATOS_ADMIN_URL: ...
```

Confirmed: the finding is real, not a false positive.

## Implement

Added the three missing keys to `infrastructure/k8s/10-config.yaml`, immediately after the existing
`KETO_READ_URL` entry, following the same non-secret in-cluster-DNS convention already used for it:

```yaml
KETO_READ_URL: "http://keto.data.svc.cluster.local:4466"
KETO_WRITE_URL: "http://keto.data.svc.cluster.local:4467"
KRATOS_PUBLIC_URL: "http://kratos.data.svc.cluster.local:4433"
KRATOS_ADMIN_URL: "http://kratos.data.svc.cluster.local:4434"
```

Port numbers are Ory's own documented defaults (Keto write API 4467, Kratos public API 4433, Kratos
admin API 4434), not invented — 4467 is independently corroborated by
`.github/workflows/ory-integration.yml:25` (`KETO_WRITE_URL_TEST: http://localhost:4467`), which
already runs a live Keto in CI on that exact port. No `.ts` file was touched; no business logic,
public API, or event contract changed.

## Run

Re-ran the same parse-and-load probe against the fixed file:

```
RESULT: config loaded OK
KETO_WRITE_URL: http://keto.data.svc.cluster.local:4467
KRATOS_PUBLIC_URL: http://kratos.data.svc.cluster.local:4433
KRATOS_ADMIN_URL: http://kratos.data.svc.cluster.local:4434
```

Quality gates (unaffected by a YAML-only change, run for completeness):

| Gate      | Result                                      |
| --------- | ------------------------------------------- |
| typecheck | ✅ 76/76                                    |
| lint      | ✅ 76/76                                    |
| test      | ✅ 24 files / 116 tests passed              |
| arch      | ✅ 0 violations (1,531 modules, 6,672 deps) |

## Scope note

The audit also suggested adding a manifest-render boot-smoke check to `validate.yml` so this class of
drift cannot recur silently. That is a CI/CD change and out of scope for "fix ONLY the
deployment/runtime configuration" — not implemented here. Recommended as a follow-up, not done.

## Status: FIXED
