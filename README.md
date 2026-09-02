# Premium educational-toys commerce platform

Monorepo for the platform. **Phase 2, Sprint 0.1 — foundation bootstrap only** (no business
features). The architecture contract in [`docs/architecture/`](docs/architecture/README.md) is the
source of truth; the admin **UI follows the Lumo Design System** ([`docs/ui/`](docs/ui/README.md)).

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

| Path                    | What                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `apps/storefront`       | Next.js app shell (foundation smoke-screen)                                                            |
| `apps/admin-web`        | Next.js admin surface — the Lumo Dashboard. See [`apps/admin-web/README.md`](apps/admin-web/README.md) for the write-screen recipe |
| `apps/admin`            | `@platform/admin` — admin wiring facades (backend only, no React)                                      |
| `packages/*`            | Shared `@platform/*` packages (ui, design, types, utils, config, tracking) + shared build configs      |
| `infrastructure/docker` | Dockerfile + compose                                                                                   |
| `docs/*`                | Architecture, UI (Lumo Design System), growth, analytics, admin, platform, implementation, development |
| `docs/plans/*`          | **Frontend↔backend wiring plan** — phased, executable. Start at [`docs/plans/README.md`](docs/plans/README.md) |

Full map: [docs/development/FOLDER_STRUCTURE.md](docs/development/FOLDER_STRUCTURE.md) ·
Workspaces: [docs/development/WORKSPACE_GUIDE.md](docs/development/WORKSPACE_GUIDE.md) ·
Standards: [docs/development/CODING_STANDARDS.md](docs/development/CODING_STANDARDS.md).

## Scripts

`pnpm dev` · `pnpm build` · `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm format` ·
`pnpm gen` · `pnpm changeset`.

## Scope of Sprint 0.1

Foundation only: monorepo, shared packages, design tokens + theme provider + dark mode, shadcn base
primitives, quality tooling, env management, Docker, CI, logging/error/flag/config infrastructure,
tracking **types**. **No** auth, database, APIs, business components, or features — those begin in
later sprints per the [implementation roadmap](docs/implementation/IMPLEMENTATION_ROADMAP.md).
