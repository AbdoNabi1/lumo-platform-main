# CRITICAL-5 REPORT — No migration step runs before rollout

**Finding closed:** C2-5, `FINAL_PRODUCTION_READINESS_AUDIT_v2.md`
**Type:** One job inserted into the existing `deploy.yml`. No new workflow file, no new trigger, no
restructuring of `validate.yml`/`build.yml`/`ci.yml`/`db-integration.yml`.

## Investigate

- `.github/workflows/deploy.yml` (pre-fix): jobs were `validate` → `scan` → `verify-signature` →
  `deploy`. The `deploy` job configures kubectl, pins the target image via `kustomize edit set
image`, and runs `kubectl apply -k .` — **no step anywhere runs a migration.**
- `.github/workflows/db-integration.yml:60` runs `prisma migrate deploy`, but only against an
  **ephemeral CI Postgres service** (`services.postgres`, lines 21-34) — never against a deployment
  target.
- `infrastructure/k8s/`: the only `Job` resource is `70-debezium.yaml:120`, which registers the CDC
  connector — not a migration. No `initContainer` on any Deployment runs one either
  (`20-deployment-api.yaml`, `21-deployment-worker.yaml`, `22-deployment-scheduler.yaml` all inspected —
  none present).

**Conclusion:** a deploy ships code whose tables may not exist in the target database. Confirmed, not
assumed — there is no migration execution anywhere on the path from "image built" to "pods running."

## Prove

Re-read `deploy.yml` end to end (58 lines) and every file under `infrastructure/k8s/`; both checks
above are exhaustive, not sampled.

## Implement

Added one `migrate` job to `.github/workflows/deploy.yml`, gated the same way `deploy` already is
(`environment: ${{ inputs.environment }}`, so it uses that environment's own secrets and approval
gate), and added `migrate` to `deploy`'s `needs` so the rollout cannot start until migrations succeed:

```yaml
migrate:
  name: apply pending migrations (${{ inputs.environment }})
  needs: [validate, scan, verify-signature]
  runs-on: ubuntu-latest
  environment: ${{ inputs.environment }}
  steps:
    - uses: actions/checkout@v4
    - uses: ./.github/actions/setup
    - name: Generate Prisma client
      run: pnpm --filter @platform/db exec prisma generate
    - name: Deploy migrations
      env:
        DATABASE_URL: ${{ secrets.DATABASE_URL }}
      run: pnpm --filter @platform/db exec prisma migrate deploy

deploy:
  needs: [validate, scan, verify-signature, migrate] # was: [validate, scan, verify-signature]
  ...
```

Every piece reuses something that already exists, nothing new was invented:

- `prisma migrate deploy` is the **same command** `db-integration.yml:60` already runs in CI —
  copied, not designed.
- `.github/actions/setup` is the **existing** shared composite action (its own doc comment: "Single
  source of truth for toolchain setup so no workflow duplicates it") — used instead of hand-rolling
  the pnpm/Node steps `db-integration.yml` duplicates.
- `environment: ${{ inputs.environment }}` is the **same** GitHub Environment gate `deploy` already
  uses for `KUBECONFIG_B64` — `DATABASE_URL` is scoped the identical way, per-environment secrets.
- `pnpm --filter @platform/db exec prisma generate` before `migrate deploy` mirrors
  `db-integration.yml:56-60` exactly.

**What did not change:** `validate.yml`, `build.yml`, `ci.yml`, `db-integration.yml`,
`ory-integration.yml`, `release.yml` — none touched. `deploy.yml`'s trigger, inputs, concurrency
group, and every existing job's steps are untouched; the only edits are the new `migrate` job block
and one `needs` array on `deploy`.

## Run

GitHub Actions workflows cannot be executed locally, so this was verified by parsing the actual file
with the same YAML library this repository already depends on transitively (`js-yaml`, resolved from
`node_modules/.pnpm`) and checking the job graph GitHub Actions itself would build: every `needs`
reference resolves to a real job, no dependency cycle exists, and `deploy` specifically depends on
`migrate`.

```
Parsed OK. Jobs: [ 'validate', 'scan', 'verify-signature', 'migrate', 'deploy' ]
OK: 'deploy' job needs 'migrate' — migrations gate the rollout
migrate steps: [ 'actions/checkout@v4', './.github/actions/setup', 'Generate Prisma client', 'Deploy migrations' ]
migrate needs: [ 'validate', 'scan', 'verify-signature' ]
deploy needs: [ 'validate', 'scan', 'verify-signature', 'migrate' ]
RESULT: deploy.yml is well-formed and migrate gates deploy
```

Quality gates (unaffected by a YAML-only change; run for completeness per the work order):

| Gate      | Result                                              |
| --------- | --------------------------------------------------- |
| typecheck | ✅ 76/76                                            |
| lint      | ✅ 76/76                                            |
| test      | ✅ 76/76 tasks; runtime: 25 files/121 tests         |
| arch      | ✅ 0 violations (1,531 modules, 6,672 dependencies) |

## Scope note

This job requires a `DATABASE_URL` secret to be configured per GitHub Environment (`dev`/`staging`/
`production`) — the same operational step already required for `KUBECONFIG_B64`, which this workflow
already assumed was provisioned out-of-band. Provisioning that secret is an operator action, not a
code change, and out of scope here.

The workflow's `deploy` job checks out `main` at whatever ref the run started from, and `workflow_dispatch`
does not pin a specific commit to the `image_digest` input — so a `migrate` step run from that same
checkout is only guaranteed to match the image when `deploy.yml` is invoked at the commit the image
was actually built from (the intended and, per `release.yml`, the normal usage). This is a pre-existing
property of the workflow's design (the `deploy` job already assumes this for `infrastructure/k8s/`)
and was not introduced or worsened by this fix.

## Status: FIXED
