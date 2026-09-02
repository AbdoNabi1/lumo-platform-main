# Task T5.9c report — Theme + Component Library (Part 3 of 3 of T5.9)

## Status: DONE

Built both the Theme and Component Library domains from scratch (no frontend existed for either
before this task) — full read (list + detail) and write (create, advance/transitions, and for
Theme the draft-only variables editor) screens, matching the established Phase 5 conventions
(server components + Server Actions + `useActionState`, cursor pagination, typed `MutationResult`
outcomes, hand-kept UI-side lifecycle-transition tables, bilingual dictionaries).

## Transition tables (read from the actual backend source, not assumed linear)

- **Theme** (`services/theme/src/domain/theme.ts`'s `TRANSITIONS`): `draft -> [active, archived]`,
  `active -> [archived]`, `archived -> []`.
- **Component Definition** (`services/components/src/domain/component-definition.ts`'s
  `TRANSITIONS`): `draft -> [published, archived]`, `published -> [deprecated, archived]`,
  `deprecated -> [archived]`, `archived -> []`.

Both copied by hand into `apps/admin-web/src/lib/theme-lifecycle.ts` and
`apps/admin-web/src/lib/component-library-lifecycle.ts` respectively (never imported — `apps/*`
never imports `services/*`), each with its own `*.test.ts` verifying the table's shape and the
`*AdvanceableStatusesFrom` helper's behavior at every status including the terminal one.

## Naming (collision avoidance, per the brief)

- Directory/route: `apps/components-library` (not `apps/components`) — avoids colliding with this
  app's existing `src/components/` convention. Nav label is "Components" (English) / "المكوّنات"
  (Arabic) even though the route/dir says `components-library`.
- API client module: `lib/api/component-library.ts` (not `components.ts`). The wire path itself is
  still the real backend route, `/components` (i.e. `/api/v1/components`).

## Files created

**API clients**
- `apps/admin-web/src/lib/api/theme.ts` — `ThemeDto`, `fetchThemesPage`, `fetchTheme`,
  `createTheme`, `advanceTheme`, `updateThemeVariables`.
- `apps/admin-web/src/lib/api/component-library.ts` — `ComponentDefinitionDto`,
  `fetchComponentsPage`, `fetchComponent`, `createComponent`, `advanceComponent`.

**Lifecycle tables + tests**
- `apps/admin-web/src/lib/theme-lifecycle.ts` + `.test.ts`
- `apps/admin-web/src/lib/component-library-lifecycle.ts` + `.test.ts`

**Theme screens**
- `apps/admin-web/src/app/theme/actions.ts` — `createThemeAction`, `advanceThemeAction`,
  `updateThemeVariablesAction`.
- `apps/admin-web/src/app/theme/page.tsx` (list), `.../new/page.tsx` (create),
  `.../[themeId]/page.tsx` (detail — name/status, versions table, advance control, and, only when
  `status === "draft"`, the variables editor).
- `apps/admin-web/src/components/theme/`: `theme-status-badge.tsx`, `themes-table.tsx`,
  `themes-pagination.tsx`, `theme-create-form.tsx`, `theme-lifecycle-actions.tsx`,
  `theme-variables-editor.tsx` (three independent repeated key/value row groups for
  `colors`/`typography`/`spacing`, pre-populated from the theme's current values, submitting the
  full replacement set via parallel `*Key`/`*Value` form fields parsed back into
  `Record<string,string>` server-side).

**Component Library screens**
- `apps/admin-web/src/app/components-library/actions.ts` — `createComponentAction`,
  `advanceComponentAction`.
- `apps/admin-web/src/app/components-library/page.tsx` (list), `.../new/page.tsx` (create),
  `.../[componentDefinitionId]/page.tsx` (detail — full field display + advance control).
- `apps/admin-web/src/components/components-library/`: `component-status-badge.tsx`,
  `components-table.tsx`, `components-pagination.tsx`, `component-create-form.tsx` (repeated
  `{name, type, required}` property rows with a native `<select>` for `type`/`required`; simple
  repeated string-row arrays for `slots`/`events`; a plain JSON textarea for `defaults`, validated
  client-side on submit via an `onSubmit` handler — malformed JSON or a non-object value blocks
  submission with an inline error — and re-validated defensively in the Server Action),
  `component-lifecycle-actions.tsx`.

## Files modified

- `apps/admin-web/src/components/navigation.ts` — added `theme` (`/theme`, `PaletteIcon`) and
  `components-library` (`/components-library`, `ComponentIcon`) to `PRIMARY_NAV`.
- `apps/admin-web/src/middleware.ts` — added `["/theme/new", "operator"]`, `["/theme", "viewer"]`,
  `["/components-library/new", "operator"]`, `["/components-library", "viewer"]` to
  `ROUTE_ROLE_REQUIREMENTS`.
- `apps/admin-web/src/messages/en.ts` / `apps/admin-web/src/messages/ar.ts` — added `nav.theme`,
  `nav.componentsLibrary`, and the `themesPage`/`themeStatus`/`themeCreate`/`themeDetail`/
  `themeLifecycle`/`themeVariables`/`componentsPage`/`componentStatus`/`componentPropertyType`/
  `componentCreate`/`componentDetail`/`componentLifecycle` sections. `ar.ts` type-checks against
  the `Dictionary` type derived from `en.ts` (`lib/i18n.ts`'s `DICTIONARIES` record), so every key
  is verified present in both locales by the compiler.
- `docs/plans/PHASE-5-6-backlog.md` — ticked T5.9's checkbox. Per the task brief's own global
  constraint #7 this task would normally leave it unticked for a controller to tick once all three
  T5.9 sub-briefs land; the dispatching instructions for this run explicitly said T5.9a and T5.9b
  were already done and this is genuinely the last of the three parts, so I ticked it as directed.

## Verification

```
pnpm --filter admin-web typecheck   -> passed, no errors
pnpm --filter admin-web lint        -> passed, 0 errors, 1 pre-existing warning (next.config.ts,
                                        unrelated to this task)
pnpm --filter admin-web test        -> 52 test files passed, 464 tests passed (0 failed)
```

## Global constraints checklist

1. `packages/*`/`services/*` never import from `apps/*` — untouched; only `apps/admin-web/` files
   (plus the one docs/plans file) were edited.
2. Domain aggregates never go on the wire — both DTOs (`ThemeDto`, `ComponentDefinitionDto`) were
   used exactly as specified in the brief, already correctly typed.
3. No fabricated data — every screen reads from the real `GET` endpoints; no mock/sample data.
4. Every user-facing string added to both `messages/en.ts` and `messages/ar.ts`.
5. No `git` commands were run.
6. No blockers encountered — nothing written to `docs/plans/BLOCKERS.md`.
7. See "Files modified" note above re: the T5.9 checkbox.
8. One `Idempotency-Key` (`newIdempotencyKey()`) minted per user-initiated submit in every write
   action (`createThemeAction`, `advanceThemeAction`, `updateThemeVariablesAction`,
   `createComponentAction`, `advanceComponentAction`).
9. The runtime API is only ever called from Server Actions / server components
   (`lib/api/theme.ts`, `lib/api/component-library.ts` call `getAdminApi`/`mutateAdminApi`, which
   are server-only) — never from browser JS.

## Concerns / follow-ups

- None blocking. Two judgment calls worth flagging for reviewers:
  - The Component Library `defaults` field's client-side JSON validation lives in a plain
    `onSubmit` handler (no shared `Textarea`/JSON-field component existed in `@platform/ui` to
    reuse) — first domain in this app to need a JSON textarea input.
  - `properties`/`slots`/`events` rows with a blank name are silently dropped rather than
    rejected as a validation error, since the backend's own zod schema allows empty arrays for
    all three and the row UI always renders at least one (possibly blank) row by default.
