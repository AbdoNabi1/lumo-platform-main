# Developer setup

## Prerequisites

- **Node 22 LTS** (see `.nvmrc` → `nvm use`).
- **pnpm 9** via Corepack: `corepack enable`.
- **Docker** (optional, for the containerized dev environment).

## Install

```bash
corepack enable
pnpm install
```

## Environment

```bash
cp .env.example .env.local
```

No secrets are required for the foundation. Variables are validated at boot by `@platform/config`
(`loadEnv()`); invalid config fails fast with a clear message.

## Run

```bash
pnpm dev          # all apps (turbo) — storefront on http://localhost:3000
pnpm --filter storefront dev   # just the storefront
```

### Docker (alternative)

```bash
docker compose -f infrastructure/docker/docker-compose.yml up
```

## Common scripts (root)

| Script | Purpose |
|---|---|
| `pnpm dev` | Run apps in watch mode (turbo) |
| `pnpm build` | Build all buildable packages/apps |
| `pnpm lint` | ESLint across the workspace |
| `pnpm typecheck` | `tsc --noEmit` across the workspace |
| `pnpm test` | Test runner (placeholder until tests land) |
| `pnpm format` / `pnpm format:check` | Prettier write / verify |
| `pnpm gen` | Scaffold a new `@platform/*` package |
| `pnpm changeset` | Record a release intent for a shared package |

## Git hooks

Husky installs on `pnpm install` (`prepare` script): `pre-commit` runs lint-staged (ESLint + Prettier
on staged files), `commit-msg` enforces Conventional Commits via commitlint.
