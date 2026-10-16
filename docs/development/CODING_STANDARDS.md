# Coding standards

These standards apply repo-wide and align with the architecture contract (`docs/architecture/`)
and the global engineering rules.

## TypeScript

- Strict mode everywhere (`@platform/tsconfig/base.json`); `noUncheckedIndexedAccess`,
  `verbatimModuleSyntax`, `isolatedModules` on.
- Prefer `type` imports (`import type …`) — enforced by ESLint.
- No `any` in shipped code; model unknowns as `unknown` and narrow.

## Imports & aliases

- Inside an app: absolute imports via `@/*` (mapped to `./src/*`).
- Cross-package: import the public entry only — `@platform/<pkg>` (never deep paths into another
  package's `src`).

## Formatting & linting

- Prettier (`@platform/prettier-config`): 2-space, double quotes, width 100, semicolons,
  trailing commas. Run `pnpm format`.
- ESLint 9 flat config (`@platform/eslint-config`). Run `pnpm lint`. Formatting is delegated to
  Prettier (`eslint-config-prettier` disables conflicting rules).

## Commits

- [Conventional Commits](https://www.conventionalcommits.org/) — enforced by commitlint on
  `commit-msg`. Example: `feat(ui): add card primitive`.

## Engineering rules (non-negotiable)

- **No hardcoded secrets** — use env via `@platform/config`; secrets come from a secret manager.
- **Handle errors explicitly** — use `@platform/utils` (`AppError`, `invariant`); never swallow.
- **Immutable patterns** — return new objects; avoid in-place mutation.
- **Validate input at boundaries** — zod schemas (env already does this).
- **Logging** — use `@platform/utils` `createLogger`/`logger`; no raw `console.log` in shipped code.
- **Tests** — 80% minimum coverage is the target once test infra lands (placeholder today).

## Design & UI

- The UI follows the **Morbeh Design System** (`docs/ui/MORBEH_DESIGN_SYSTEM.md`) — the platform's one canonical design system. Build from `@platform/ui` primitives and consume semantic tokens from `@platform/design`; never hard-code a colour, radius, shadow, duration, or spacing value, and never start a second design system.
- Never use raw hex — reference design tokens / Tailwind semantic utilities (`bg-background`, etc.).
- Sentence case, two font weights (400/500), flat surfaces (no shadows) — per the frozen design system.
- Accessibility: WCAG 2.2 AA for user-facing UI.
