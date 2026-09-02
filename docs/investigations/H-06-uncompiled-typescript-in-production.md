# H-06 — Production runs uncompiled TypeScript through `tsx`, which is a devDependency

| Field                      | Value                                                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Severity**               | High (as reported) → **downgraded on investigation: Medium**                                                                                                                   |
| **Area**                   | Deployment / Packaging / Startup performance                                                                                                                                   |
| **Baseline**               | `main` @ `756bce3`                                                                                                                                                             |
| **Blocker verdict**        | **Intentional, documented architectural decision — NOT a blocker.** One concrete sub-issue (a `--prod` install omitting `tsx`) is a real hazard and is worth a one-line guard. |
| **Public contract change** | **No.**                                                                                                                                                                        |

---

## 1. Location

| File                                              | Line  | What is there                                                          |
| ------------------------------------------------- | ----- | ---------------------------------------------------------------------- |
| `infrastructure/k8s/20-deployment-api.yaml`       | 71    | `args: ["node", "--import", "tsx", "src/api.ts"]`                      |
| `infrastructure/k8s/21-deployment-worker.yaml`    | 70    | `args: ["node", "--import", "tsx", "src/worker.ts"]`                   |
| `infrastructure/k8s/22-deployment-scheduler.yaml` | 49    | `args: ["node", "--import", "tsx", "src/scheduler.ts"]`                |
| `apps/runtime/package.json`                       | 12–22 | Scripts — **no `build`**                                               |
| `apps/runtime/package.json`                       | 44    | `"tsx": "^4.19.1"` under **`devDependencies`**                         |
| `infrastructure/k8s/20-deployment-api.yaml`       | 74–80 | Startup probe: `periodSeconds: 3 × failureThreshold: 30` = 90 s budget |
| `infrastructure/k8s/20-deployment-api.yaml`       | 115   | `readOnlyRootFilesystem: true`                                         |

---

## 2. Current implementation

All three runtime processes execute TypeScript sources directly:

```yaml
# infrastructure/k8s/20-deployment-api.yaml:70-71
# Override args only (keeps the image's tini ENTRYPOINT → SIGTERM forwarding, F4).
args: ["node", "--import", "tsx", "src/api.ts"]
```

`apps/runtime` has no build step:

```json
"scripts": {
  "lint": "eslint .",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "dev": "node scripts/dev-all.mjs",
  "dev:api": "tsx watch src/api.ts",
  "start:api": "tsx src/api.ts",
  "start:worker": "tsx src/worker.ts",
  "start:scheduler": "tsx src/scheduler.ts"
},
"devDependencies": { ..., "tsx": "^4.19.1", ... }
```

so `turbo run build` (`.github/workflows/ci.yml:39`) emits nothing for the runtime. Type safety is enforced separately via `typecheck: tsc --noEmit`, which **does** run in CI (`ci.yml:36`).

The container image (missing from `main`, preserved in `de46df9` — see C-02) is built to match:

```dockerfile
# de46df9:infrastructure/docker/runtime.Dockerfile
# The app executes TypeScript via `tsx` (there is no compile step in the current architecture), so
# the runtime artifacts are the workspace source + the installed prod graph + the generated Prisma
# client. Packaging only — no application behavior changes.
...
FROM base AS builder
RUN pnpm install --frozen-lockfile --prefer-offline    # ← deliberately NOT --prod
FROM base AS runtime
ENV NODE_ENV=production XDG_CACHE_HOME=/tmp            # ← tsx cache → /tmp (readOnlyRootFilesystem)
COPY --from=builder --chown=node:node /app /app
```

`build.yml` in `de46df9` says the same thing: _"turbo build: `next build` for the storefront; backend packages have no build (tsx runtime)."_

---

## 3. Why it is (and is not) incorrect

**On investigation, the original High rating overstated this.** Three independent artefacts — the Dockerfile, the build workflow, and the k8s manifests — describe the same deliberate architecture, and it is internally consistent:

- Type errors **are** caught: `pnpm typecheck` runs `tsc --noEmit` per workspace in CI.
- The `XDG_CACHE_HOME=/tmp` env in the image is set precisely because the manifests use `readOnlyRootFilesystem: true` with a `/tmp` `emptyDir`. Someone reasoned this through.
- The 90-second startup-probe budget is documented as protecting _"a slow boot (tsx transpile + lazy client connect)"_ (`20-deployment-api.yaml:74`). The cost was measured for and accommodated.
- The Dockerfile deliberately omits `--prod` and says why.

So this is not an oversight. What remains genuinely wrong is narrower:

1. **The `--prod` trap.** `tsx` is a **devDependency**. The image works only because the Dockerfile installs the full graph. Any future optimisation — `pnpm install --prod`, `pnpm prune --prod`, a `node_modules` slimming layer, or a distroless rebuild — silently removes `tsx` and the container fails at startup with `Cannot find module 'tsx'`. Nothing in the repository prevents or detects this. Given C-02 (the Dockerfile is currently missing and will be restored or rewritten by someone), the trap is live.
2. **Repeated transpile cost on a read-only rootfs.** With `readOnlyRootFilesystem: true` and the tsx cache on an `emptyDir`, the cache is empty on every pod start. Every restart, every scale-out event, and every rolling update pays full transpile cost across `apps/runtime` plus its 29 workspace dependencies. Under the HPA (`40-autoscaling.yaml`), scale-out is exactly when startup latency matters most.
3. **No runtime type-stripping guarantee.** `tsc --noEmit` and `tsx`'s esbuild-based stripping are different implementations. They agree in practice, but nothing verifies that the code CI typechecked is the code that runs — there is no emitted, hashed artefact in between.

---

## 4. Production impact

**Moderate, not severe.**

- **Startup latency.** A 90-second startup-probe budget is a large allowance. It delays rollouts (`maxUnavailable: 0, maxSurge: 1` means each pod must pass startup before the next is replaced) and delays HPA scale-out response.
- **Latent packaging failure.** If anyone applies a standard production-image optimisation, all three Deployments enter `CrashLoopBackOff` with a module-resolution error. This would most likely be discovered in production, since there is no image build in CI today (C-02/C-03).
- **Larger image and attack surface.** Shipping the full dev dependency graph (TypeScript, ESLint, Vitest, tsx and their transitive trees) into the runtime image increases both size and the set of packages a CVE scan will flag. `deploy.yml:35-46` runs Trivy with `severity: HIGH,CRITICAL, exit-code: "1"` — dev-tree CVEs will block deploys for packages that never execute. `docs/KNOWN_GAPS.md` G-31 already tracks 8 open advisories, mostly dev tooling.
- **No correctness impact.** The code that runs is the code in the repository, type-checked by CI.

---

## 5. Smallest additive fix

**Do not change the architecture.** The tsx approach is coherent and changing it is a larger project than this finding justifies. Fix the two concrete hazards.

### Step 1 — close the `--prod` trap (one line, do this with C-02)

Move `tsx` from `devDependencies` to `dependencies` in `apps/runtime/package.json`:

```json
"dependencies": {
  ...
  "tsx": "^4.19.1",          // ← runtime loader, not a build tool: required at run time
  "zod": "^3.25.0"
}
```

This is factually correct — `tsx` _is_ a runtime dependency of this application — and it makes `--prod` installs safe. It also lets the Dockerfile use `--prod` later without a footgun.

### Step 2 — assert it at boot (~4 lines, additive)

Cheap protection against the same class of packaging regression:

```ts
// apps/runtime/src/config.ts or a new preflight
if (!process.execArgv.some((a) => a.includes("tsx")) && !("tsx" in process.env)) {
  // fail loudly rather than surfacing as a module-resolution stack trace
}
```

Lower value than Step 1; include only if cheap.

### Step 3 — add an image smoke test to CI (once C-02/C-03 land)

`build.yml` already builds the image with `load: true` when not pushing. Add one step: run the built image with `--help`-equivalent or a 10-second `/healthz` probe against a stub config. That catches the `--prod` trap, a missing Prisma engine, and a broken `tini` ENTRYPOINT in a single check.

### Optional (larger, not recommended now)

If startup latency later proves unacceptable, `tsc --build` with project references would emit JS per workspace and remove `tsx` from the runtime path. That is a multi-package change touching every `tsconfig.json` and both Dockerfiles — a project, not a fix, and it should be driven by measured startup times rather than by this finding.

---

## 6. Public contract impact

**None.**

- Moving `tsx` between dependency sections changes no code, no signature, and no exported surface. The installed graph in the current image is unchanged (it already installs devDependencies).
- No HTTP route, event schema, or package export changes.
- The k8s `args` are unchanged.

---

## 7. Blocker or intentional deferral?

**Intentional, documented architectural decision — and I am downgrading this finding from High to Medium.**

Three separate artefacts state it explicitly:

- `de46df9:infrastructure/docker/runtime.Dockerfile`: _"The app executes TypeScript via `tsx` (there is no compile step in the current architecture)."_
- `de46df9:.github/workflows/build.yml`: _"backend packages have no build (tsx runtime)."_
- `infrastructure/k8s/20-deployment-api.yaml:74`: the startup probe _"protects a slow boot (tsx transpile + lazy client connect) from liveness"_.

`docs/KNOWN_GAPS.md` does not list it as a gap because it is not one — it is a chosen trade-off with the cost priced in. Type safety is preserved through `tsc --noEmit` in CI.

**Verdict: not a blocker.** The original High rating conflated "unusual" with "wrong". The residual real risk is the `--prod` trap, which is a one-line fix, and the startup cost, which is already accommodated by the manifests. Neither should hold a deployment.

---

## 8. How this was verified

- `apps/runtime/package.json` read in full — no `build` script; `tsx` under `devDependencies`.
- `grep 'image:\|args:\|failureThreshold\|readOnlyRootFilesystem'` over all three k8s Deployments → line numbers above.
- `git show de46df9:infrastructure/docker/runtime.Dockerfile` read in full — `XDG_CACHE_HOME=/tmp`, no `--prod`, `tini` ENTRYPOINT, non-root `node`.
- `git show de46df9:.github/workflows/build.yml` read — confirms the "no backend build" intent.
- `.github/workflows/ci.yml:36` confirmed to run `pnpm typecheck`.
- `turbo.json` read — `build` outputs `.next/**` and `dist/**`; `apps/runtime` produces neither.
- No code was modified.
