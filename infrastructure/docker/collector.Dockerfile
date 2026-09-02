# syntax=docker/dockerfile:1
#
# H-07: production image for the tracking collector (apps/collector) — the public HTTP ingress for
# browser-emitted events. Previously no Dockerfile built this image at all; `runtime.Dockerfile`
# builds only api/worker/scheduler. Same builder pattern as `runtime.Dockerfile` (Rule of Three does
# not apply across a genuinely different app with a different port, different env contract, and a
# public-facing security posture) — the collector runs `tsx` too, so packaging is workspace source +
# installed prod graph, no compile step, no application behavior change.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable && corepack prepare pnpm@11.9.0 --activate
WORKDIR /app

# ---- builder: deterministic install (frozen lockfile) ----
FROM base AS builder
ENV CI=1
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
WORKDIR /app/apps/collector
EXPOSE 3200
# H-07: image-level liveness, same convention as runtime.Dockerfile — /healthz only; readiness
# (which now reflects the Kafka producer's real connection state, see main.ts) stays with k8s /readyz.
HEALTHCHECK --interval=15s --timeout=5s --start-period=25s --retries=5 \
  CMD ["node", "-e", "require('http').get('http://127.0.0.1:3200/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--import", "tsx", "src/main.ts"]
