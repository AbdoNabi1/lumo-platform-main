# RELEASE_PROCESS — how Morbeh ships (Sprint 3.0A)

> Honest status: **CI exists and is green** (.github/workflows/ci.yml: lint/typecheck/build/test/
> arch + non-blocking audit); everything after CI is DESIGNED here and in doc 15 §2, and becomes
> executable with the deploy sprint (needs the k8s/GitOps host). No stage below is faked.

## Pipeline

```
feature branch → PR (CI: lint · typecheck · test · build · dependency-cruiser · audit)
  → preview environment (per-PR compose/namespace; smoke: /healthz /readyz + inject suite)
  → merge to main → staging (migrate deploy FIRST — expand/contract, MIGRATIONS.md §1)
  → smoke tests (health, one write path incl. outbox→CDC→consumer round-trip, OpenAPI diff)
  → production (rolling; api → worker → scheduler order; workers drain via supervisor.stopAll)
  → automatic rollback: failed readiness or smoke ⇒ previous image; migrations are
    expand-only at deploy time, so rollback never needs a down-migration
```

## Rules

1. **Migrations before code, expand→migrate→contract** (zero-downtime, MIGRATIONS.md).
2. **Sprint-ordered commits** — each sprint = one commit referencing its report (see reports
   §Recommended Commit for the exact messages). Conventional Commits enforced (commitlint).
3. **No release with a red gate**; the CI audit step becomes blocking after G-31.
4. **Rollback drills** and backup/restore drills (G-14) are release-process preconditions for
   the first production tag.
5. Versioning: changesets (already configured) once packages publish; apps deploy by image tag.
