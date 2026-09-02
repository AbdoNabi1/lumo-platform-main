# syntax=docker/dockerfile:1
# Production-ready, multi-stage image for the storefront (Next.js standalone).
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
COPY apps/storefront/package.json ./apps/storefront/package.json
COPY packages ./packages
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ── Dev (hot reload; used by docker-compose) ───────────────────────────────────
FROM deps AS dev
ENV NODE_ENV=development
COPY . .
EXPOSE 3000
CMD ["pnpm", "--filter", "storefront", "dev"]

# ── Builder ───────────────────────────────────────────────────────────────────
FROM deps AS builder
ENV NODE_ENV=production
COPY . .
RUN pnpm --filter storefront build

# ── Runner (production) ────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
WORKDIR /app
COPY --from=builder --chown=nextjs:nodejs /app/apps/storefront/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/storefront/.next/static ./apps/storefront/.next/static
USER nextjs
EXPOSE 3000
# Healthcheck hits the home page (no API routes exist in Sprint 0.1).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1
CMD ["node", "apps/storefront/server.js"]
