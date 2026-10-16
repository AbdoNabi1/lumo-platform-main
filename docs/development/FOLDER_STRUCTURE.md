# Folder structure

Top-level layout follows `docs/architecture/02` (deployment-axis at the top; feature-first inside
apps/services).

```
platform/
├── apps/
│   ├── storefront/             Next.js 15 app shell (foundation; no business pages)
│   └── admin-web/              Next.js admin surface — the Morbeh Dashboard (docs/ui/)
├── packages/
│   ├── ui/                     @platform/ui — shadcn primitives, theme provider, cn
│   ├── design/                 @platform/design — frozen design tokens + Tailwind v4 theme
│   ├── types/                  @platform/types — generic utility types
│   ├── utils/                  @platform/utils — logging + error helpers
│   ├── config/                 @platform/config — typed env + feature-flag infra
│   ├── tracking/               @platform/tracking — tracking types only
│   ├── eslint-config/          @platform/eslint-config — shared ESLint flat configs
│   ├── tsconfig/               @platform/tsconfig — shared TS bases
│   └── prettier-config/        @platform/prettier-config — shared Prettier config
├── services/                   (empty placeholder) backend bounded-context services — later phases
├── edge/                       (empty placeholder) Cloudflare Workers — later phases
├── infrastructure/
│   └── docker/                 web.Dockerfile + docker-compose.yml
├── tooling/                    generators (see turbo/generators), codemods, scripts
├── turbo/generators/           `pnpm gen` package scaffolder
├── docs/                       architecture/ ui/ growth/ analytics/ admin/ platform/
│   │                           implementation/ + development/ (this guide)
├── .github/workflows/          CI (install → lint → typecheck → build → test → artifact)
├── .changeset/                 versioning
├── .husky/                     git hooks (pre-commit, commit-msg)
└── .vscode/                    editor settings + recommended extensions
```

Root config files: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.json`, `.npmrc`,
`.nvmrc`, `.gitignore`, `.dockerignore`, `.editorconfig`, `.prettierignore`, `prettier.config.mjs`,
`eslint.config.mjs`, `commitlint.config.mjs`, `.lintstagedrc.json`, `.env.example`.
