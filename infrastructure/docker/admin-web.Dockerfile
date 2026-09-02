# syntax=docker/dockerfile:1
# Production-ready, multi-stage image for admin-web (Next.js standalone) — Phase A.34 (A.33 Task 1:
# admin-web had no deployment story at all). Byte-for-byte the same pattern as web.Dockerfile
# (storefront); only the package filter and port differ (3100, apps/admin-web/package.json's
# "dev"/"start" scripts). next.config.ts already sets output:"standalone" — this Dockerfile is
# what actually uses that output; it was inert without it.
# Build context is the monorepo root. See infrastructure/docker/docker-compose.yml for dev.

# ── Base ──────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# ── Dependencies ──────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/admin-web/package.json ./apps/admin-web/package.json
COPY packages ./packages
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ── Dev (hot reload; used by docker-compose) ───────────────────────────────────
FROM deps AS dev
ENV NODE_ENV=development
COPY . .
EXPOSE 3100
CMD ["pnpm", "--filter", "admin-web", "dev"]

# ── Builder ───────────────────────────────────────────────────────────────────
FROM deps AS builder
ENV NODE_ENV=production
COPY . .
RUN pnpm --filter admin-web build

# ── Runner (production) ────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3100
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
WORKDIR /app
COPY --from=builder --chown=nextjs:nodejs /app/apps/admin-web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/admin-web/.next/static ./apps/admin-web/.next/static
USER nextjs
EXPOSE 3100
# /api/healthz (Phase A.34) is the only route in this app that returns 200 with zero downstream
# calls (every other route either requires a session or calls Hydra/Kratos) — same convention as
# apps/runtime's /healthz, added specifically so this HEALTHCHECK (and the k8s probes that reuse
# it, infrastructure/k8s/77-deployment-admin-web.yaml) never depend on the auth backend being up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3100/api/healthz || exit 1
CMD ["node", "apps/admin-web/server.js"]
