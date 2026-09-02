# Sprint 3.1 Report — Infrastructure Stabilization: BLOCKED AT TASK 1 (evidence-backed)

> 2026-07-05. Rules honored: no fake infrastructure, no continuation past an unhealthy dependency.

## Task 1 — Docker stability diagnosis (all statements evidence-backed)

- Current state: `docker info` fails; WSL `docker-desktop` distro **Stopped**; only
  `com.docker.service` resident; Docker Desktop backend absent.
- Launch attempt this sprint: `Docker Desktop.exe` started + engine polled **4 minutes** →
  backend never spawned (same as both 3.0B attempts).
- **Smoking gun** (`%LOCALAPPDATA%\Docker\log\host\com.docker.backend.exe.log`): final entries
  at `2026-07-05T20:19` show vpnkit adding/removing a TCP forward for **0.0.0.0:8086 →
  172.21.0.8:8080** — that is **Apicurio from our compose stack**. Conclusion: during the 3.0B
  retry the engine ran and containers were actually starting; the backend then died mid-startup
  and has never run since. The 5-second add→remove suggests the container (or the whole VM) was
  being torn down as it came up — consistent with WSL resource exhaustion.

## Verdict

Two independent operator-level requirements before ANY re-attempt (do not re-try headless):

1. Start Docker Desktop **interactively** and confirm "Engine running" persists ≥ 2 minutes.
2. Raise WSL resources (Settings → Resources: ≥ 6–8 GB / 4 CPUs) and pre-pull
   (`docker compose … pull`) before `up -d` in batches (full runbook: SPRINT_3_0B_REPORT §Retry #2).

Tasks 2–9 remain blocked and unclaimed. No suite was marked green; no container status was
fabricated. The repository baseline (3.0C) means this machine instability now risks nothing.

## First Boot attempt #3 (2026-07-05, same day — via the Prisma-diagnosis window)

New facts only (full evidence chain: 3.0B report + retry #2, 3.1 report):

1. **Longest observed engine uptime yet:** during the Prisma root-cause diagnosis the operator''s
   interactive start kept the engine alive **43+ minutes with `lumo-postgres-1` healthy** —
   interactive starts DO work and stability improved vs the pull-crash. It then died again
   between two commands (P1001 → pipe gone), still without surviving a full session.
2. **A guaranteed Step-5 failure was found and fixed AHEAD of the boot:** `migrate deploy` would
   have failed even on a healthy engine — the migrations folder was at the single-file-schema
   location while prisma@6.19.3 anchors it to the datasource file''s directory for folder
   schemas. Root-caused from the installed build, fixed by `git mv` to
   `prisma/schema/migrations` (commit `3afe0c5`, MIGRATIONS.md §0).
3. Attempt #3 status: **blocked at Step 1** (engine down at t0; headless re-attempt skipped per
   the recorded rule). Steps 2 (compose config ✅, unchanged) noted; 3–25 blocked.

Operator sequence remains unchanged (3.0B §Retry #2) — with one improvement: once the engine is
up, Step 5 will now succeed on the first try.
