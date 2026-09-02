# C-02 — No container image exists for the runtime, and nothing builds one

| Field                      | Value                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Severity**               | Critical                                                                                                           |
| **Area**                   | Deployment / Packaging                                                                                             |
| **Baseline**               | `main` @ `756bce3`                                                                                                 |
| **Blocker verdict**        | **True blocker.** Not a deferral — the file was written, reviewed, and then dropped during history reconstruction. |
| **Public contract change** | **No.**                                                                                                            |

---

## 1. Location

| File                                              | Lines | What is there                                                    |
| ------------------------------------------------- | ----- | ---------------------------------------------------------------- |
| `infrastructure/docker/web.Dockerfile`            | 1–48  | The **only** Dockerfile on `main`; builds the Next.js storefront |
| `infrastructure/k8s/20-deployment-api.yaml`       | 68    | `image: lumo-runtime:local`                                      |
| `infrastructure/k8s/21-deployment-worker.yaml`    | 68    | `image: lumo-runtime:local`                                      |
| `infrastructure/k8s/22-deployment-scheduler.yaml` | 47    | `image: lumo-runtime:local`                                      |
| `apps/runtime/package.json`                       | 12–22 | Scripts block — **no `build` script**                            |
| `.github/workflows/release.yml`                   | 47    | `cosign sign … ghcr.io/${{ github.repository }}/runtime@…`       |

**Absent from `main`, present in `de46df9`:** `infrastructure/docker/runtime.Dockerfile`.

---

## 2. Current implementation

A recursive filesystem search for `*ockerfile*` across the repository, excluding `node_modules`, returns exactly one path:

```
C:\Users\abdoh\Claude code\Git\lumo-platform\infrastructure\docker\web.Dockerfile
```

Its final stage is unambiguously the storefront:

```dockerfile
# infrastructure/docker/web.Dockerfile — runner stage
COPY --from=builder --chown=nextjs:nodejs /app/apps/storefront/.next/standalone ./
USER nextjs
CMD ["node", "apps/storefront/server.js"]
```

All three runtime Deployments reference an image nothing produces:

```yaml
# infrastructure/k8s/20-deployment-api.yaml:68
image: lumo-runtime:local # production: a registry-pushed, immutable tag or digest
```

And `apps/runtime/package.json` has no build step at all:

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
}
```

so `turbo run build` (invoked by `.github/workflows/ci.yml:39`) produces no artifact for the runtime.

---

## 3. Why it is incorrect

The k8s manifests, the release workflow, and the deploy workflow all assume an image named `ghcr.io/<owner>/<repo>/runtime` exists. Nothing on `main` can produce it. This is not a design gap — it is a **missing file**.

`de46df9` contains `infrastructure/docker/runtime.Dockerfile`, and it is good:

```dockerfile
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
# tini = PID 1 init (reaps zombies, forwards SIGTERM → graceful shutdown, F4); openssl for the
# Prisma query engine; ca-certificates for outbound TLS.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable && corepack prepare pnpm@11.9.0 --activate
WORKDIR /app

FROM base AS builder
ENV CI=1
COPY pnpm-lock.yaml .npmrc ./
RUN pnpm fetch                       # cacheable dep layer keyed on the lockfile alone
COPY . .
RUN pnpm install --frozen-lockfile --prefer-offline

FROM base AS runtime
ENV NODE_ENV=production XDG_CACHE_HOME=/tmp
COPY --from=builder --chown=node:node /app /app
USER node
WORKDIR /app/apps/runtime
EXPOSE 3080
HEALTHCHECK --interval=15s --timeout=5s --start-period=25s --retries=5 \
  CMD ["node", "-e", "require('http').get('http://127.0.0.1:3080/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--import", "tsx", "src/api.ts"]
```

It is correct on every point the k8s manifests depend on: `tini` as PID 1 (which is why `20-deployment-api.yaml:70` says _"Override args only (keeps the image's tini ENTRYPOINT → SIGTERM forwarding, F4)"_ — a comment that is currently orphaned), non-root `node` user, `XDG_CACHE_HOME=/tmp` matching the manifests' `readOnlyRootFilesystem: true` + `/tmp` emptyDir, and `openssl` for the Prisma query engine.

**The manifests on `main` were written against this Dockerfile.** They reference behaviour only it provides. The two were separated by the history reconstruction, not by a decision.

---

## 4. Production impact

**Deployment is impossible.** `kubectl apply -k infrastructure/k8s` produces three Deployments that never start:

- `runtime-api` (2 replicas), `runtime-worker` (2 replicas), `runtime-scheduler` (1 replica) → all `ErrImagePull` / `ImagePullBackOff`.
- `deploy.yml` requires an `image_digest` input; there is no artifact to supply.
- `release.yml:47` signs a digest that `build.yml` (also absent, C-03) would have produced.
- There is nothing to scan, sign, promote, or roll back to.

There is also a subtler consequence: because no image is built, **no one has ever confirmed the runtime's dependency graph installs cleanly in a production-mode container** — `tsx` is a devDependency (H-06), and a `--prod` install would omit it.

---

## 5. Smallest additive fix

**One file restore.**

```bash
git checkout de46df9 -- infrastructure/docker/runtime.Dockerfile
```

Then review three things before trusting it:

1. **`pnpm install --frozen-lockfile` includes devDependencies.** The Dockerfile deliberately does _not_ pass `--prod`, because the runtime executes TypeScript through `tsx`, which is a devDependency (see H-06). That is correct **as written** and must not be "optimised" to `--prod` without first resolving H-06.
2. **`corepack prepare pnpm@11.9.0`** matches `package.json`'s `"packageManager": "pnpm@11.9.0"`. Verified consistent at this HEAD.
3. **Prisma client generation** happens via `packages/db`'s `postinstall: prisma generate`, which runs inside `pnpm install`. Confirm the generated client lands in the copied `/app` tree.

This restore is purely additive: it creates one new file and changes no existing behaviour. It does not by itself make deployment work — C-03 must land too, because `build.yml` is what invokes this Dockerfile.

---

## 6. Public contract impact

**None.** A Dockerfile is a build input. No TypeScript signature, HTTP route, event schema, or package export changes.

---

## 7. Blocker or intentional deferral?

**True blocker, and explicitly _not_ a deferral.**

Nothing in `docs/KNOWN_GAPS.md` defers containerization. On the contrary, the k8s manifests, `deploy.yml`, and `release.yml` were all authored on the assumption that the image exists — `20-deployment-api.yaml:70` even references the image's `tini` ENTRYPOINT by name. The gap register's G-41 (_first live boot_) presumes a bootable image.

This is a **file-loss defect from the history reconstruction**, and the reconstruction commit `de46df9` says so plainly in its own message: _"a raw, unfiltered snapshot of every uncommitted file that existed in this working tree … taken so that none of it is lost when `main` is fast-forwarded to the recovery/history-reconstruction branch."_ The file was preserved exactly so it could be recovered. It has not been.

---

## 8. How this was verified

- `Get-ChildItem -Recurse -Filter "*ockerfile*"` excluding `node_modules` → 1 result.
- `git ls-tree -r --name-only de46df9 | grep -i ockerfile` → `runtime.Dockerfile` **and** `web.Dockerfile`.
- `git show de46df9:infrastructure/docker/runtime.Dockerfile` read in full.
- `grep -n 'image:\|args:' infrastructure/k8s/2*.yaml` → line numbers above.
- `apps/runtime/package.json` read in full.
- No code was modified.
