# syntax=docker/dockerfile:1
#
# Production image for the Morbeh runtime processes (api / worker / scheduler). ONE image for all
# three — they share an identical build and differ only in the entrypoint file, which the compose
# `command` selects (Rule of Three: three near-identical Dockerfiles would be duplication). The app
# executes TypeScript via `tsx` (there is no compile step in the current architecture), so the
# runtime artifacts are the workspace source + the installed prod graph + the generated Prisma
# client. Packaging only — no application behavior changes.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
# tini = PID 1 init (reaps zombies, forwards SIGTERM → graceful shutdown, F4); openssl for the
# Prisma query engine; ca-certificates for outbound TLS.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable && corepack prepare pnpm@11.9.0 --activate
WORKDIR /app

# ---- builder: deterministic install (frozen lockfile) + Prisma client generation (postinstall) ----
FROM base AS builder
ENV CI=1
# Cacheable dependency layer: `pnpm fetch` needs only the lockfile, so it is re-run only when the
# lockfile changes — not on every source edit (BuildKit-friendly layering).
COPY pnpm-lock.yaml .npmrc ./
RUN pnpm fetch
COPY . .
RUN pnpm install --frozen-lockfile --prefer-offline

# ---- runtime: minimal image, non-root, tini init ----
FROM base AS runtime
ENV NODE_ENV=production \
    XDG_CACHE_HOME=/tmp
COPY --from=builder --chown=node:node /app /app
USER node
WORKDIR /app/apps/runtime
# Health/metrics port (same inside every container; compose maps distinct host ports).
EXPOSE 3080
# H-5: image-level liveness so any orchestrator (compose, Swarm, plain Docker) gets health for free.
# Kubernetes ignores this and uses its own probes; the node one-liner needs no extra tooling on the
# read-only rootfs. Liveness only (/healthz) — readiness gating stays with k8s /readyz.
HEALTHCHECK --interval=15s --timeout=5s --start-period=25s --retries=5 \
  CMD ["node", "-e", "require('http').get('http://127.0.0.1:3080/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "--"]
# Default process; compose overrides `command` for the worker and scheduler.
CMD ["node", "--import", "tsx", "src/api.ts"]
