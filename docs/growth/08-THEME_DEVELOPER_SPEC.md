# 08 — Theme Developer specification

> **Status: CONTRACT (Phase 1 — Growth) — 2026-06-28.** Specification for a safe storefront theme
> development environment. Relates to the shared block kit (`packages/page-builder-kit`,
> [arch 02](../architecture/02-monorepo-packages-and-feature-first.md)), the content context
> ([arch 03](../architecture/03-domain-and-database-boundaries.md)), the layout builder
> ([growth 02](02-PRODUCT_LAYOUT_BUILDER_SPEC.md)), and deployment
> ([arch 15](../architecture/15-scalability-and-deployment.md)). No application code.
>
> **Design system note:** this is a **net-new admin surface and requires approval** before any UI is
> built ([`../ui/`](../ui/README.md)). Critically, the **admin UI itself is frozen and is NOT
> theme-editable** — the theme developer edits the **storefront theme layer only**. This document
> specifies the capability, scope, and guardrails.

## 1. Cross-cutting compliance baseline

| Concern                | Requirement                                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tracking               | Edit/preview/publish actions emit operational events; published themes preserve storefront tracking                                                   |
| Analytics              | Theme version → conversion impact joinable in ClickHouse                                                                                              |
| Audit logs             | Every edit/publish/rollback/import → `audit.entry.recorded` (WORM) with actor + diff                                                                  |
| Permissions            | `theme_developer` (edit/draft) vs `theme_publisher` (publish) separated ([arch 07](../architecture/07-auth-and-authorization.md)); step-up to publish |
| Feature flags          | Theme versions publishable behind a flag / gradual rollout ([growth 06](06-FEATURE_MANAGEMENT_SPEC.md))                                               |
| Dark mode / Responsive | The editor surface uses frozen tokens + responsive rules; the theme it produces is itself responsive                                                  |
| Localization           | Theme strings are i18n-keyed; per-locale theme assets supported                                                                                       |
| Accessibility          | The editor is WCAG 2.2 AA; published themes are linted for a11y before publish                                                                        |
| Version history        | Every save is an immutable version; full diff/compare/rollback                                                                                        |

## 2. Editable scope and the hard guardrail

| Editable (theme layer)                                                                                      | NEVER editable (core platform)                                                 |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Storefront templates, sections, blocks (page-builder/theme assets)                                          | Backend services (`services/**`)                                               |
| Theme styles/tokens, layout settings                                                                        | Shared packages (`packages/**`), incl. the design system + block kit internals |
| Theme JS limited to a sandboxed, CSP-constrained surface (no server execution)                              | Infrastructure (`infrastructure/**`), CI/CD, secrets                           |
| Translations / locale assets                                                                                | The **admin UI** ([`../ui/`](../ui/README.md))                                 |
| Custom blocks via the registered plugin contract ([arch 11](../architecture/11-integration-and-plugins.md)) | Database, migrations, event/contract schemas                                   |

**Guardrail (non-negotiable):** the environment is sandboxed to an allowlisted theme file scope.
Any attempt to read/write outside that scope is rejected. Theme code is declarative/templated and
runs under a strict CSP; **no arbitrary server-side code execution**. This is enforced by the
platform, not by convention.

## 3. Capabilities

| Capability       | Behavior                                                                               |
| ---------------- | -------------------------------------------------------------------------------------- |
| Search files     | Full-text search within the allowlisted theme scope only                               |
| Edit theme files | Edit theme templates/sections/styles/translations in the sandbox                       |
| Preview changes  | Live preview of the draft theme per device + as-audience, without affecting live       |
| Compare versions | Side-by-side diff between any two theme versions                                       |
| Rollback         | Restore any prior published version instantly (versioned + audited)                    |
| Draft mode       | All edits live in a draft; shoppers never see drafts                                   |
| Publish          | Promote a draft → live; immediate, scheduled, or flag-gated (gradual)                  |
| Git integration  | Theme repo is **separate** from the platform repo; branch/PR/CI checks; GitOps publish |
| Theme backup     | Automatic immutable snapshot before each publish                                       |
| Theme export     | Download a theme as a portable, versioned package                                      |
| Theme import     | Upload a theme package; validated + linted before it can be published                  |

## 4. Safety model

- **Scope allowlist** + path validation; writes outside the theme layer are impossible.
- **Validation/lint on save and pre-publish:** schema validity, broken references, a11y checks, performance budget (Core Web Vitals, [arch 15](../architecture/15-scalability-and-deployment.md)), and CSP compliance for any custom code.
- **No core access:** the environment has no filesystem/network access beyond the theme scope and approved asset storage.
- **Review + approval** before publish (separation of duties); publishes are signed + audited.
- **Custom components** must be registered plugins with declared scopes — not arbitrary code.

## 5. Git, versioning, backup, import/export

- Theme changes flow through a theme repository with branches/PRs and CI (lint + a11y + perf gates), publishing via GitOps ([arch 15](../architecture/15-scalability-and-deployment.md)).
- Every publish creates an immutable version + automatic backup; rollback re-publishes a prior version.
- Export produces a portable package (templates + assets + translations + manifest); import validates the manifest, scope, and lint gates before allowing publish.

## 6. Frozen-UI surface mapping

This developer environment is a net-new operator surface and **requires approval** before any UI
exists. It must never expose the admin UI or any core platform file for editing.

## Requires ADR to change

- The editable-scope allowlist or the "core platform / admin UI is never theme-editable" guardrail.
- The no-server-side-execution / CSP-sandbox model, or the separate-theme-repo + GitOps publish flow.
- The draft → version → publish → rollback workflow, or introducing the admin surface (also requires UI approval).
