# Task T5.9c brief — Theme + Component Library (read screens from scratch + write)

Part 3 of 3 covering T5.9. Same write-screen recipe as every prior Phase 5 task. **No frontend
exists for either domain** — build both read and write for both. Scope (`apps/theme`,
`apps/components-library` — do not name it `apps/components`, that would collide with the
existing `src/components/` directory convention; use `apps/components-library` or similar, your
call — `lib/api/theme.ts`, `lib/api/component-library.ts`) does not overlap T5.9a/T5.9b or any
earlier Phase 5 task.

## Theme — `apps/admin/src/http/theme-routes.ts` (read in full, verbatim below)

`ThemeDto`: `{ id, name, status, colors: Record<string,string>, typography: Record<string,string>,
spacing: Record<string,string>, versions: Array<{versionNumber: number, publishedAt: string}> }`.

| Route | Method | Permission | Body |
| --- | --- | --- | --- |
| `/themes` (create) | POST | `theme:create` | `{ name: string.min(1), presetKey: string.min(1) }` |
| `/themes/:themeId/transitions` | POST | `theme:advance` | `{ toStatus: "draft"\|"active"\|"archived" }` |
| `/themes/:themeId/variables` | POST | `theme:update_variables` | `{ colors: Record<string,string>, typography: Record<string,string>, spacing: Record<string,string> }` — full replace, draft-only per its summary ("Update a draft theme's variables") |
| `/themes` (list) | GET | `theme:read` | `{ first?, after?, last?, before? }` |
| `/themes/:themeId` (get) | GET | `theme:read` | — |

Build: `apps/admin-web/src/lib/api/theme.ts` (list/get + 3 mutate functions),
`apps/admin-web/src/app/theme/page.tsx` (list) + `.../new/page.tsx` (create — `presetKey` is a
plain text input, no preset catalog/picker in scope) + `.../[themeId]/page.tsx` (detail: shows
name/status/versions table, an advance control gated by status — draft/active/archived is a
simple linear-ish lifecycle, read the actual transition rules from wherever `services/theme`
defines them rather than assuming, same as every prior task's transition-table treatment — and,
only when `status === "draft"`, a variables editor form). The variables editor: `colors`/
`typography`/`spacing` are each a `Record<string,string>` — render each as a repeated key/value
row array (same array-of-rows technique used throughout Phase 5), pre-populated from the current
theme's values, submitting the full replacement set.

## Component Library — `apps/admin/src/http/components-routes.ts` (read in full, verbatim below)

`ComponentDefinitionDto`: `{ id, key, name, properties: Array<{name, type, required: boolean}>,
defaults: Record<string, unknown>, slots: string[], events: string[], responsive: boolean,
permission: string|null, featureFlagKey: string|null, status }`.

| Route | Method | Permission | Body |
| --- | --- | --- | --- |
| `/components` (create) | POST | `components:create` | `{ key: string.min(1), name: string.min(1), properties: Array<{name: string.min(1), type: "string"\|"number"\|"boolean"\|"object"\|"array", required: boolean}>, defaults?: Record<string,unknown>, slots: string[], events: string[], responsive: boolean, permission?: string.min(1), featureFlagKey?: string.min(1) }` |
| `/components/:componentDefinitionId/transitions` | POST | `components:advance` | `{ toStatus: "draft"\|"published"\|"deprecated"\|"archived" }` |
| `/components` (list) | GET | `components:read` | `{ first?, after?, last?, before? }` |
| `/components/:componentDefinitionId` (get) | GET | `components:read` | — |

The `defaults` field is `Record<string, unknown>` — for the create form, a plain JSON textarea
(parse client-side, show a validation error if it doesn't parse as an object) is acceptable; do not
over-engineer a typed-per-property editor. `properties`/`slots`/`events` are each array fields —
`properties` needs a repeated `{name, type, required}` row group (type as a native `<select>` of
the 5 allowed values), `slots`/`events` are each a simple repeated string-row array.

Build: `apps/admin-web/src/lib/api/component-library.ts` (list/get + 2 mutate functions),
`apps/admin-web/src/app/components-library/page.tsx` (list) + `.../new/page.tsx` (create) +
`.../[componentDefinitionId]/page.tsx` (detail: full field display + advance control gated by
status — read the real transition rules from `services/components`, do not assume linear).

## Navigation, middleware, dictionaries

- `PRIMARY_NAV`: `theme` entry at `/theme`, `components-library` entry at `/components-library`
  (pick a clear label like "Components" for the nav text even though the route/dir avoids the
  bare `components` name for the collision reason above).
- `middleware.ts`: `["/theme", "viewer"]`, `["/theme/new", "operator"]`,
  `["/components-library", "viewer"]`, `["/components-library/new", "operator"]`.
- Every new string in both `messages/en.ts` and `messages/ar.ts`.

## Global constraints (every Phase 5 task)

1. `packages/*`/`services/*` never import from `apps/*`.
2. Domain aggregates never go on the wire — both DTOs above are already correctly typed.
3. Never fabricate data.
4. Every user-facing string in both dictionaries.
5. Do not run `git` commands.
6. Do not ask questions; blockers go to `docs/plans/BLOCKERS.md`.
7. Do NOT tick T5.9's checkbox yourself — the controller ticks it once all three sub-briefs land.
   Note in your report that Part (Theme + Component Library) of T5.9 is complete — this closes out
   T5.9 as a whole, since T5.9a and T5.9b should already be done by the time this dispatches.
8. One `Idempotency-Key` per user-initiated submit.
9. Never call the runtime API from browser JS.

## Verify

```bash
pnpm --filter admin-web typecheck && pnpm --filter admin-web lint && pnpm --filter admin-web test
```

## Report

Write your full report to `docs/plans/.progress/task-T5.9c-report.md`. Return to the controller
only: status, files changed, one-line test summary, concerns.
