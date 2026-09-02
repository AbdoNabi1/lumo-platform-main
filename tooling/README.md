# tooling/

Repo tooling, per [`docs/architecture/02`](../docs/architecture/02-monorepo-packages-and-feature-first.md).

- **Generators** — run `pnpm gen`. The generator definitions live in `turbo/generators/`
  (Turborepo convention) and currently scaffold a new `@platform/*` package.
- **codemods/** — automated refactors (added as needed).
- **scripts/** — workspace utility scripts (added as needed).

Shared build configuration (ESLint, TypeScript, Prettier) is published as packages under
`packages/` (`@platform/eslint-config`, `@platform/tsconfig`, `@platform/prettier-config`).
