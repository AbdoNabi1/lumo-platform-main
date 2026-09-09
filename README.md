# Premium educational-toys commerce platform

Monorepo for the platform: a multi-tenant-schema'd commerce backend (40 bounded contexts under
`services/`, 461 HTTP routes, 40 Prisma schema files / 132 models across 39 Postgres schemas) with
two Next.js frontends (`apps/admin-web`, the operator dashboard; `apps/storefront`, the public
shop) and a runtime (`apps/runtime`) exposing three entrypoints — `api`, `worker`, `scheduler`.
The architecture contract in [`docs/architecture/`](docs/architecture/README.md) is the source of
truth; the admin **UI follows the Morbeh Design System** ([`docs/ui/`](docs/ui/README.md)). The
cloud topology (Supabase Postgres, Upstash Redis, Ory Network) is live —
[`docs/operations/CLOUD_RUNBOOK.md`](docs/operations/CLOUD_RUNBOOK.md) is the operator record of it.

**Open work:** [`docs/plans/UNIFIED-ROADMAP.md`](docs/plans/UNIFIED-ROADMAP.md) is the single
planning entry point — it reconciles Phase 7 (closing the product gap against the platform's own
brief) with a separate SaaS-transformation plan (rebrand, billing, platform control plane) into
one ordered set of work packages (`docs/plans/phase-7/WP-0`…`WP-18`).

## Quick start

```bash
corepack enable          # use pnpm 9
pnpm install
cp .env.example .env.local
pnpm dev                 # storefront → http://localhost:3000
```

See [docs/development/SETUP.md](docs/development/SETUP.md) for details.

## Tech

pnpm · Turborepo · Next.js 15 · React 19 · TypeScript 5 · Tailwind CSS v4 · shadcn/ui · Node 22 LTS ·
ESLint 9 · Prettier · Husky · lint-staged · commitlint · Changesets · Docker · GitHub Actions.

## Structure

| Path                    | What                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/storefront`       | Next.js app shell (foundation smoke-screen)                                                                                          |
| `apps/admin-web`        | Next.js admin surface — the Morbeh Dashboard. See [`apps/admin-web/README.md`](apps/admin-web/README.md) for the write-screen recipe |
| `apps/admin`            | `@platform/admin` — admin wiring facades (backend only, no React)                                                                    |
| `packages/*`            | Shared `@platform/*` packages (ui, design, types, utils, config, tracking) + shared build configs                                    |
| `infrastructure/docker` | Dockerfile + compose                                                                                                                 |
| `docs/*`                | Architecture, UI (Morbeh Design System), growth, analytics, admin, platform, implementation, development                             |
| `docs/plans/*`          | **Frontend↔backend wiring plan** — phased, executable. Start at [`docs/plans/UNIFIED-ROADMAP.md`](docs/plans/UNIFIED-ROADMAP.md)     |

Full map: [docs/development/FOLDER_STRUCTURE.md](docs/development/FOLDER_STRUCTURE.md) ·
Workspaces: [docs/development/WORKSPACE_GUIDE.md](docs/development/WORKSPACE_GUIDE.md) ·
Standards: [docs/development/CODING_STANDARDS.md](docs/development/CODING_STANDARDS.md).

## Scripts

`pnpm dev` · `pnpm build` · `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm test:coverage` ·
`pnpm format` · `pnpm gen` · `pnpm changeset` · `pnpm arch`.

> **On a Windows host, `turbo` does not run** — `pnpm build`/`lint`/`typecheck`/`test`/
> `test:coverage` all shell out to `turbo run <task>` and fail immediately (`STATUS_DLL_NOT_FOUND`
> / no output, exit 127; see `docs/plans/BLOCKERS.md`'s environment notes for the full history of
> this across several sessions). Use the turbo-free forms instead:
>
> ```bash
> pnpm --filter <name> run typecheck   # single package
> pnpm -r --workspace-concurrency=4 run test   # repo-wide
> pnpm arch   # architecture rules — does NOT go through turbo, always works
> ```
>
> `pnpm -r` bails on the first package failure by default — add `--no-bail` when you need a
> complete repo-wide picture rather than stopping at the first red package.
