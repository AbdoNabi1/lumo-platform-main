# Morbeh brand: apply and lock "Nusuj — Warm Weave" (نسيج — دفء ونسج)

Status: `OPUS: AGREED · Sol: AGREED (plan-review-3.md)`

**Owner decision (2026-11-19):** Morbeh adopts direction A "Nusuj" from the Rawaq brand demo
(`C:/Users/Abdo/Desktop/morbeh-demo/morbeh-rawaq-demo.html`, column A) as the platform brand, fully,
and the theme is LOCKED: nobody (human or model) changes brand colours, fonts, radii or the logo
without an explicit order from the owner.

Defaults taken while the owner's clarify form timed out (each is cheap to reverse and is listed in
the final report): (1) scope = admin-web (dashboard + auth pages) and the storefront's _default_
palette for shops that have not saved their own colours; merchant-saved theme documents are never
rewritten; storefront fonts stay the merchant-chosen families. (2) Dark mode stays, using the demo's
authored Nusuj dark palette. (3) The lock is enforced by a test, CODEOWNERS and a doc.

- Branch: `morbeh/brand-nusuj` in worktree `F:/New folder/morbeh-brand`, BASE `9ffc7b4b` (origin/main).
- Spec = this file + the demo file above. Canonical design doc: `docs/ui/MORBEH_DESIGN_SYSTEM.md`.
- pnpm: `node C:/Users/Abdo/AppData/Local/node/corepack/v1/pnpm/11.9.0/bin/pnpm.cjs` (written `PNPM` below).

## Implementers

| Task                                                                  | Route       | Why                          |
| --------------------------------------------------------------------- | ----------- | ---------------------------- |
| 1 Tokens + lock test                                                  | impl-sonnet | UI-only (design tokens, CSS) |
| 2 admin-web fonts, logo, favicon, button shape                        | impl-sonnet | UI-only                      |
| 3 Docs + CODEOWNERS                                                   | impl-terra  | docs (odd number)            |
| Tasks run strictly in order (2 consumes 1's tokens; 3 documents 1+2). |

## Amendments preamble (binding) — plan review 1

Precedence: `**Amendments (binding)**` block at the end of a task > the task's original text > this plan's tables (the tables stay the value source unless an amendment changes a value).

- A1 (finding 4): test-EXPECTATION-only edits under `apps/*` are allowed in Task 1. App production code stays out of Task 1.
- A2 (finding 8): `BrandLockup` is removed from scope. All five auth headers keep `<BrandMark />` + their existing "Morbeh Admin" text.
- A3 (finding 3): page titles keep their existing weight utilities (`font-semibold` = 600; Baloo Bhaijaan 2 ships 600). The h1 rule sets ONLY the family. There is no 700 requirement.
- A4 (finding 9): `packages/storefront-content/src/fonts.ts`, its family keys and every font string in its tests/snapshot stay byte-identical.
- A5 (finding 5/6): the lock is "contract tests + CODEOWNERS + AGENTS.md + docs". It becomes an owner-only merge gate only if GitHub branch protection requires code-owner review; Opus checks that at acceptance and reports it, and never changes remote settings.

**Amendments round 2 (binding)** — precedence: round 2 > round 1 > original task text > tables.

- A6 (Plan review 2, finding 1): drift-mutation demonstrations belong to the TASK REVIEWER (reviewer-sol), never to implementers. After Task 1 the reviewer edits dark `primaryActive` in both `semantic.ts` and `styles.css` (scratch edit), confirms `brand-lock.test.ts` fails, restores. After Task 2 the reviewer separately (a) changes `--font-latin` in `apps/admin-web/src/app/globals.css`, (b) changes button `rounded-full` back to `rounded-xl`, (c) changes the favicon fill in `icon.svg`, confirming `brand-fonts.test.ts`, `primitives.test.tsx`, `icon.test.ts` respectively fail, restoring after each. Then the reviewer confirms the unmutated suites pass and `git status --porcelain` shows no leftover change, and records all results in the task review. No mutation is ever committed.
- A7 (Plan review 2, finding 2): at acceptance Opus reads the `main` branch protection/rulesets (`gh api repos/AbdoNabi1/lumo-platform-main/branches/main/protection` and `gh api repos/AbdoNabi1/lumo-platform-main/rulesets`) and reports (a) whether code-owner approval is required and (b) the required status-check names, and whether they cover the jobs that run the design, ui and admin-web test suites (`.github/workflows/ci.yml`). If either is missing or unreadable, the owner is told the manual prerequisite and the result is called "a documented, tested lock", not "an owner-only merge gate". No remote setting is changed.

## Global constraints (every task)

- Product code never hard-codes a hex; components use semantic tokens (`bg-primary`, `var(--primary)`).
  The only hex values allowed are in `packages/design/src/{primitives.ts,styles.css}`, the lock test,
  `apps/admin-web/src/app/icon.svg`, and `layout.tsx` `themeColor` (browser chrome needs literals).
- `styles.css` and `primitives.ts`/`semantic.ts` must hold IDENTICAL values (Task 1's lock test proves it).
- Lowercase hex everywhere in code (`#b8451d`), matching the repo's existing style.
- RTL: logical properties only (`ms-`, `pe-`, `start`), never `left/right`. Brand names inside `<bdi dir="auto">` where they sit in running text.
- Hard rules: no git stash/checkout/reset/force-push, no `--no-verify`, stage only the task's files,
  commit with `git -c user.name="Abdullah Nabil" -c user.email="abdoheyday@gmail.com"`, conventional
  type, trailer `Co-Authored-By: <your model>`. Husky needs `pnpm` on PATH: prepend a scratch dir with a
  `pnpm` sh shim (`#!/bin/sh` + `exec node <pnpm.cjs> "$@"`). New test files start with `expect.hasAssertions()` per test (or `beforeEach(() => expect.hasAssertions())`).

## The locked palette (single source for every task)

### Primitives

`primary` (terracotta, hue ≈15°) — replaces the purple ramp; `500` is canonical:

| 50      | 100     | 200     | 300     | 400     | **500**     | 600     | 700     | 800     | 900     | 950     |
| ------- | ------- | ------- | ------- | ------- | ----------- | ------- | ------- | ------- | ------- | ------- |
| #fdf3ee | #fae4d8 | #f5c9b4 | #f5916e | #ef7b52 | **#b8451d** | #9a3714 | #7e2d10 | #64240d | #4c1c0b | #3a1c10 |

`neutral` (warm sand, light-side) — replaces slate:

| 0       | 50      | 100     | 200     | 300     | 400     | 500     | 600     | 700     | 800     | 900     | 950     |
| ------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- |
| #ffffff | #fcf8f3 | #f3e9de | #e8ded3 | #d5c8ba | #a1968b | #8a7f75 | #5d636a | #3f3a36 | #2b2724 | #212529 | #141210 |

NEW `night` ramp (dark-theme surfaces/text; authored, not inverted):

| 50      | 300     | 400     | 500     | 700     | 800     | 850     | 900     | 950     |
| ------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- |
| #faf6f2 | #d3c9bf | #b5aca3 | #8c8279 | #3f3832 | #342e29 | #29231e | #1e1b18 | #141210 |

NEW `brand` (logo two-tone): `{ light: { secondary: "#4c362e", iconAccent: "#f9d5c6" }, dark: { secondary: "#dec8b4", iconAccent: "#f9d5c6" } }`.

`status`:

|         | light primary / soft / strong | dark primary / soft / strong |
| ------- | ----------------------------- | ---------------------------- |
| success | #1f8a57 / #ebf7f0 / #1a6e47   | #2fa36b / #142b20 / #5bd998  |
| warning | #c77a0a / #fef4e5 / #8e5005   | #d9901c / #2c2111 / #f3b753  |
| error   | #c0263a / #fcebec / #9b1c2e   | #e5484d / #3a1518 / #ff8a8f  |
| info    | #3a6ea5 / #edf4fa / #2f5882   | #4a86c5 / #162331 / #83b5e8  |

### Semantic (light → dark)

| token                                           | light                                                                  | dark                                                              |
| ----------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| background                                      | neutral50 #fcf8f3                                                      | night950 #141210                                                  |
| foreground                                      | neutral900 #212529                                                     | night50 #faf6f2                                                   |
| card / cardForeground                           | neutral0 / neutral900                                                  | night900 #1e1b18 / night50                                        |
| popover / popoverForeground                     | neutral0 / neutral900                                                  | night850 #29231e / night50                                        |
| surface / surfaceForeground                     | neutral100 #f3e9de / neutral900                                        | night850 / night50                                                |
| muted / mutedForeground                         | neutral100 / neutral600 #5d636a                                        | night850 / night400 #b5aca3                                       |
| subtleForeground                                | neutral400 #a1968b                                                     | night500 #8c8279                                                  |
| secondary / secondaryForeground                 | neutral100 / neutral700 #3f3a36                                        | night850 / night300 #d3c9bf                                       |
| accent / accentForeground                       | neutral100 / neutral900                                                | night850 / night50                                                |
| border / borderStrong                           | neutral200 #e8ded3 / neutral300 #d5c8ba                                | night800 #342e29 / night700 #3f3832                               |
| input                                           | neutral500 #8a7f75                                                     | night500 #8c8279                                                  |
| ring                                            | primary500                                                             | primary400 #ef7b52                                                |
| primary / primaryForeground                     | primary500 #b8451d / neutral0                                          | primary400 #ef7b52 / **#1a1512**                                  |
| primaryHover / primaryActive                    | primary600 / primary700                                                | primary300 #f5916e / primary200 #f5c9b4                           |
| primarySubtle / primarySubtleForeground         | primary100 / primary700                                                | primary950 #3a1c10 / primary300                                   |
| success / successSubtle / successForeground     | status.light.success.*                                                 | status.dark.success.*                                             |
| warning / warningSubtle / warningForeground     | status.light.warning.*                                                 | status.dark.warning.*                                             |
| destructive / destructiveForeground             | error.primary / neutral0                                               | error.primary #e5484d / **#1a1512**                               |
| destructiveSubtle / destructiveSubtleForeground | error.soft / error.strong                                              | error.soft / error.strong                                         |
| info / infoSubtle / infoForeground              | status.light.info.*                                                    | status.dark.info.*                                                |
| chart1..5                                       | primary500, neutral500, info.primary, warning.primary, success.primary | primary400, night400, info.strong, warning.strong, success.strong |
| **brandSecondary** (NEW)                        | #4c362e                                                                | #dec8b4                                                           |
| **brandIconAccent** (NEW)                       | #f9d5c6                                                                | #f9d5c6                                                           |

`#1a1512` is a literal in both TS and CSS (the "on-primary ink"); add it to `primitives.ts` as `onPrimaryInk`.
All text pairs in `contrast.test.ts` were pre-computed by Opus and clear AA (lowest: light chart4 3.38 non-text, dark destructive label 4.63).

### Other locked values

- Fonts: Latin UI **Plus Jakarta Sans**; Arabic UI **Zain**; display (h1, brand wordmark) **Baloo Bhaijaan 2**.
  Zain ships 200/300/400/700/800/900 only: weight 500 renders as 400 and 600 as 700 in Arabic. Accepted; do not fake weights.
- Radius: `--radius-2xl` = **22px** (cards; was 20). Buttons are pills (`rounded-full`). Other radius steps unchanged.
- Shadows (light): `sm/md/lg/xl` use ink `rgb(33 29 26 / α)` with the SAME α values as today; `card` = `0 1px 2px 0 rgb(184 69 29 / 0.05), 0 12px 28px -8px rgb(76 54 46 / 0.10)`; `cardHover` = `0 2px 4px 0 rgb(184 69 29 / 0.07), 0 16px 36px -8px rgb(76 54 46 / 0.16)`. Dark shadows unchanged.
- Canvas glows: rename `--lumo-glow-purple` → `--lumo-glow-warm`, `--lumo-glow-blue` → `--lumo-glow-sand`.
  Light: warm = `color-mix(in srgb, var(--lumo-primary-200) 26%, transparent)`, sand = `color-mix(in srgb, var(--lumo-neutral-200) 60%, transparent)`.
  Dark: warm = `color-mix(in srgb, var(--lumo-primary-800) 28%, transparent)`, sand = `color-mix(in srgb, var(--lumo-night-800) 40%, transparent)`.
- Logo = the 2×2 bento, viewBox `0 0 64 64`: `circle(17,19,r9)` secondary · `rect(30,10,26×18,rx9)` primary · `rect(8,36,26×18,rx9)` primary · `circle(47,45,r9)` secondary.
- App icon/favicon: rounded square `rx 14` fill #b8451d, bento scaled `translate(6 6) scale(.81)`, pills #ffffff, circles #f9d5c6.

---

### Task 1 — Design tokens + brand lock test (implementer: sonnet)

**Files (modify):** `packages/design/src/primitives.ts`, `packages/design/src/semantic.ts`,
`packages/design/src/styles.css`, `packages/design/src/index.ts`, `packages/design/src/contrast.test.ts`.
**Files (create):** `packages/design/src/brand-lock.test.ts`.
**Files (modify, test expectations only):** every test/snapshot outside `packages/design` that asserts the OLD
_default palette_ (find with `git grep -n -i "635bff\|f8fafc\|0f172a\|020617"` — exclude docs/plans). Known:
`packages/storefront-content/src/css-vars.test.ts` (lines asserting `--primary`/`--ring` from the default doc),
`packages/storefront-content/src/__snapshots__/css-vars.test.ts.snap`, `packages/storefront-content/src/theme-document.hardening.test.ts:102`, `theme-document.test.ts:28` if it reads the default.
Tests that merely use `#635bff` as an arbitrary INPUT colour (`color.test.ts` `bestTextOn("#635bff")`,
`form-controls.test.tsx`, `services/theme/src/domain/theme.test.ts`) stay untouched.

**Steps**

1. Write `brand-lock.test.ts` first (fails on the purple palette). It must:
   - assert exact primitives: `primary[500]==="#b8451d"`, `primary[600]==="#9a3714"`, `primary[400]==="#ef7b52"`, every ramp step from the tables above (use one `it.each` over a literal table of `[path, value]`).
   - assert exact semantic values for BOTH themes for: background, foreground, card, primary, primaryForeground, primaryHover, border, input, ring, brandSecondary, brandIconAccent, successForeground, destructive.
   - assert `typography.fontSans` contains `"Plus Jakarta Sans"`, `typography.fontArabic` contains `"Zain"`, NEW `typography.fontDisplay` contains `"Baloo Bhaijaan 2"`; `radius["2xl"]==="22px"`.
   - **CSS↔TS parity:** read `styles.css` with `node:fs` (`new URL("./styles.css", import.meta.url)`), parse the `:root { … }` block and the `.dark { … }` block (simple regex over `--name: value;` lines, resolving one level of `var(--lumo-…)` to its primitive), and assert for every semantic key `k` that the resolved CSS `--kebab(k)` equals `colors.light[k]` / `colors.dark[k]` (for `.dark`, a key not redeclared inherits the `:root` value — mirror that). Expected: zero mismatches; the failure message lists each mismatched key. Also assert `--radius-2xl: 22px` appears in `@theme inline`.
   - Top-of-file comment: `LOCKED BY OWNER (2026-11-19). Changing any value here requires an explicit owner order. See docs/ui/BRAND_LOCK.md.`
2. Run it: `cd "F:/New folder/morbeh-brand" && PNPM --filter @platform/design test` → brand-lock tests FAIL (purple values).
3. `primitives.ts`: replace `primary`, `neutral`, `status` with the tables; add `night`, `brand`, `onPrimaryInk = "#1a1512"`; `radius["2xl"]="22px"`; light `elevation` per "Other locked values"; `typography`:
   `fontSans: 'var(--font-latin, "Plus Jakarta Sans"), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'`,
   `fontArabic: 'var(--font-arabic-family, "Zain"), var(--font-latin, "Plus Jakarta Sans"), ui-sans-serif, system-ui, sans-serif'`,
   `fontDisplay: 'var(--font-display-family, "Baloo Bhaijaan 2"), var(--font-latin, "Plus Jakarta Sans"), ui-sans-serif, system-ui, sans-serif'`; `weights` gains `bold: 700` (display headings). Update doc comments (no more "#635BFF"/"slate"/"Geist").
4. `semantic.ts`: add `brandSecondary` and `brandIconAccent` to `SemanticColors` (with doc comments) and set every value per the semantic table, referencing primitives (no literals except via `onPrimaryInk`). Remove the comment about "#635BFF held in both themes"; replace with one line: dark fills use the lighter 400 step with ink labels.
5. `styles.css`: mirror steps 3–4 exactly: primitives `--lumo-primary-*`, `--lumo-neutral-*`, NEW `--lumo-night-*`, `--lumo-on-primary-ink`, status, NEW semantic `--brand-secondary`, `--brand-icon-accent` (+ `.dark` overrides), `.dark` block per table, shadows, renamed glows (update `.lumo-canvas` to use them), fonts:
   `--font-sans: var(--font-latin, "Plus Jakarta Sans"), …`; `--font-arabic: var(--font-arabic-family, "Zain"), …`; NEW `--font-display: var(--font-display-family, "Baloo Bhaijaan 2"), var(--font-sans);` and in `:root:lang(ar)` ALSO keep display as Baloo (it has Arabic glyphs) — i.e. do not override `--font-display` there.
   In `@theme inline`: `--radius-2xl: 22px`, NEW `--font-display: var(--font-display);`, NEW `--color-brand-secondary: var(--brand-secondary);`, `--color-brand-icon-accent: var(--brand-icon-accent);`. Update header comments (brand name, no purple).
   Keep every existing token NAME (other than the two glows) so no consumer breaks.
6. `index.ts`: export `night`, `brand`, `onPrimaryInk`; update the doc comment to name Nusuj and point to `docs/ui/BRAND_LOCK.md`.
7. `contrast.test.ts`: add text pair "brand secondary on card" (`brandSecondary`/`card`, AA text) and non-text "brand secondary on canvas" (3:1); change the `contrastRatio("#635bff","#635bff")` self-check to `"#b8451d"`. Every pair must pass in both themes.
8. Update the outside test expectations listed above to the new default (`#b8451d` for primary/ring, etc.). Regenerate the storefront-content snapshot with `PNPM --filter @platform/storefront-content test -- -u`, then open the `.snap` diff and confirm ONLY colour values changed.
9. Commit: `feat(design): adopt the Nusuj warm-weave brand palette and lock it`.

**Commands and expected output**

- `PNPM --filter @platform/design test` → all pass, brand-lock included (report the count).
- `PNPM --filter @platform/design typecheck` (or `exec tsc --noEmit -p packages/design`) → 0 errors.
- `PNPM --filter @platform/storefront-content test` → all pass.
- `PNPM --filter @platform/theme test` (services/theme; check the real package name in its package.json) → all pass.
- `PNPM --filter @platform/ui test` → all pass.
- `git grep -n -i "635bff" -- ':!docs'` → only the untouched arbitrary-input tests remain (list them in the report).

**Do NOT:** rename semantic tokens; touch apps/*; add fonts here; change spacing/typography sizes/motion; touch merchant theme documents or DB data.

**Amendments (binding)** — the amendment wins over the task text above.

- _Plan review 1, finding 1 — parity test contract._ Key→CSS name mapping: split camelCase before each uppercase letter AND before a digit run, lowercase, prefix `--`. So `primaryForeground → --primary-foreground`, `brandSecondary → --brand-secondary`, `brandIconAccent → --brand-icon-accent`, `chart1 → --chart-1` … `chart5 → --chart-5`. Algorithm: parse the raw declarations of `:root { … }` (rootRaw) and `.dark { … }` (darkRaw) separately, keeping values as written (`var(--lumo-…)` NOT resolved yet). Light map = rootRaw; dark map = `{ ...rootRaw, ...darkRaw }`. Then, per theme, resolve each semantic declaration's `var(--x)` against THAT theme's merged map, recursively until a hex remains (max depth 5). Compare lowercase. Fail loudly on: a semantic key with no CSS declaration, an unresolved `var()`, a non-hex result. Do not skip anything. Expect exactly 45 semantic keys per theme (`Object.keys(colors.light).length === 45`). Include two explicit assertions: dark `--success-subtle` resolves to `#142b20` (it is inherited from `:root` as `var(--lumo-success-soft)` and must pick the `.dark` primitive), and `--chart-1` light resolves to `#b8451d`.
- _Finding 5 — full contract._ `brand-lock.test.ts` asserts a literal expected map of ALL 45 semantic values for BOTH themes (copy the hexes from the semantic table; every row), not a subset. It also asserts every `radius` step (`xs 4px, sm 6px, md 8px, lg 12px, xl 16px, 2xl 22px, 3xl 28px, full 9999px`) in TS, and every `--radius-*` line in `@theme inline` in CSS; and the exact `typography.fontSans`, `fontArabic`, `fontDisplay` strings from step 3 (full string equality, not substring). Also assert the CSS `--font-sans`, `--font-arabic`, `--font-display` declarations contain the same family names and slot vars.
- _Finding 4 — files._ Add to Task 1's expectation-only edits: `apps/storefront/src/lib/online-store.test.ts:364-383` and `apps/storefront/src/lib/shell-presentation.test.ts:27-37` (old default canvas → `#fcf8f3`), `packages/storefront-content/src/theme-document.test.ts:25-32` and `css-vars.test.ts:16-21` — update ALL six default colours there to the new defaults (background `#fcf8f3`, foreground `#212529`, primary `#b8451d`, primaryForeground `#ffffff`, accent `#f3e9de`, accentForeground `#212529`, ring = primary). Only expectations that describe the DEFAULT document change; input fixtures stay. Add `PNPM --filter storefront test` → all pass to Task 1's commands.
- The final `git grep -n -i 635bff` check moves to Task 2 (button.tsx comment is Task 2's file). Task 1 reports its grep output but it may still list `packages/ui/src/components/ui/button.tsx:13`.

---

### Task 2 — admin-web: fonts, logo, favicon, pill buttons, display headings (implementer: sonnet)

Consumes Task 1's `--font-display`, `font-display` utility, `--brand-secondary`, `--brand-icon-accent`.

**Files:** `apps/admin-web/package.json` (+ `pnpm-lock.yaml` via install), `apps/admin-web/src/app/layout.tsx`,
`apps/admin-web/src/app/globals.css`, `apps/admin-web/src/components/brand-mark.tsx`,
NEW `apps/admin-web/src/components/brand-mark.test.tsx`, NEW `apps/admin-web/src/app/icon.svg`,
`apps/admin-web/src/components/app-shell.tsx` (wordmark class only), `packages/ui/src/components/ui/button.tsx`,
`apps/storefront/src/app/globals.css` (font slot binding only).

**Steps**

1. Deps: `PNPM --filter admin-web add @fontsource/plus-jakarta-sans@^5.3.0 @fontsource/zain@^5.3.0 @fontsource/baloo-bhaijaan-2@^5.3.0` (use the package's real name from package.json for `--filter`). Remove `geist` and `@fontsource/ibm-plex-sans-arabic` from admin-web ONLY if no other admin-web file imports them (grep first; storefront keeps its own).
2. `layout.tsx`: drop `GeistSans` and the Plex imports; import `@fontsource/plus-jakarta-sans/{400,500,600,700}.css`, `@fontsource/zain/{400,700,800}.css`, `@fontsource/baloo-bhaijaan-2/{600,700,800}.css`; remove `className={GeistSans.variable}`; `themeColor`: light `#fcf8f3`, dark `#141210`. Metadata title unchanged.
3. `globals.css` `:root`: `--font-latin: "Plus Jakarta Sans"; --font-arabic-family: "Zain"; --font-display-family: "Baloo Bhaijaan 2";` (remove the old `--font-geist`/Plex bindings). In `@layer base` add `h1 { font-family: var(--font-display); font-weight: 700; }` — one rule covers the 101 page titles; do NOT edit pages.
4. `apps/storefront/src/app/globals.css` `:root`: bind `--font-latin: var(--font-geist-sans, "Geist"); --font-arabic-family: "IBM Plex Sans Arabic"; --font-display-family: var(--font-heading, "IBM Plex Sans Arabic");` so the storefront's typography does not change (merchant fonts are out of scope).
5. `brand-mark.tsx`: replace the burst with the bento. Signature stays `BrandMark({ className }: { className?: string })`, default size `size-7`, `viewBox="0 0 64 64"`, `aria-hidden`, `focusable="false"`. Circles `className="fill-brand-secondary"`, pills `className="fill-primary"` (Tailwind fill utilities from tokens — no hex). Update the doc comment ("Nusuj 2×2 bento; locked, see docs/ui/BRAND_LOCK.md"). Also export `BrandLockup({ className, name }: { className?: string; name: string })`: `BrandMark` + a column with Arabic `مربح` (`dir="rtl"`, `font-display text-2xl font-extrabold leading-snug`) and Latin `Morbeh` (`dir="ltr"`, `text-xs font-extrabold tracking-wide text-muted-foreground`) — line-height ≥1.3 so Arabic ascenders are not clipped (the demo bug). Use `BrandLockup` on the five auth pages in place of the bare `<BrandMark />` ONLY where the page shows no other product name next to it (read each; if it already renders a title beside the mark, keep `BrandMark`). The app-shell sidebar keeps `BrandMark` + store name; add `font-display` to the store-name span.
6. `brand-mark.test.tsx` (lock test for geometry): render `BrandMark`, assert exactly 2 `circle` and 2 `rect`, attributes `cx=17 cy=19 r=9`, `cx=47 cy=45 r=9`, rects `x=30 y=10 width=26 height=18 rx=9` and `x=8 y=36 width=26 height=18 rx=9`, circle class contains `fill-brand-secondary`, rect class `fill-primary`, svg `aria-hidden="true"`. `BrandLockup` renders both names with the right `dir`.
7. `icon.svg` (Next file convention, served as favicon): exactly the "App icon/favicon" spec above, `xmlns`, `viewBox="0 0 64 64"`. Verify no other favicon/icon route exists (`git ls-files apps/admin-web/src/app | grep -i icon`).
8. `button.tsx`: base class `rounded-xl` → `rounded-full`; `icon` size stays a circle (`size-9` + rounded-full). Doc comment: `--primary` (Nusuj terracotta). Fix any `button` test that asserts `rounded-xl`.
9. Commit: `feat(admin-web): apply the Nusuj fonts, bento logo, favicon and pill buttons`.

**Commands and expected output**

- `PNPM --filter <admin-web pkg> test -- brand-mark app-shell login signup` → pass; then the full admin-web suite → pass (report counts; name any pre-existing failure and prove it fails on BASE too).
- `PNPM --filter <admin-web pkg> typecheck` → 0 errors; `PNPM --filter @platform/ui test` → pass; `PNPM --filter <storefront pkg> test` → pass.
- `PNPM --filter <admin-web pkg> build` → succeeds (proves fontsource CSS imports resolve).
- `PNPM install --offline --frozen-lockfile` → succeeds after your lockfile change.

**Do NOT:** edit individual page `h1`s; hard-code hex in TSX/CSS (icon.svg + themeColor excepted); change storefront fonts or merchant font list; remove the ThemeToggle.

**Amendments (binding)** — the amendment wins over the task text above.

- _Plan review 1, finding 2._ KEEP `@fontsource/ibm-plex-sans-arabic` in admin-web and KEEP its three CSS imports (400/500/600) in `layout.tsx`: the merchant theme editor's font samples (`components/online-store/customize-panels.tsx`, `fontStack()`) need Plex loaded. `@font-face` is lazy, so this costs nothing on dashboard pages. Only `geist` may be removed, and only if `git grep -n "geist" apps/admin-web/src` shows no other importer.
- _Finding 3 / A3._ The admin-web h1 rule is `@layer base { h1 { font-family: var(--font-display); } }` — family only, no weight. Do not edit pages.
- _Finding 8 / A2._ Delete step 5's `BrandLockup` entirely. The five auth pages are NOT edited. Only `brand-mark.tsx` (bento) and the app-shell store-name span (`font-display`) change.
- _Finding 9 / A4._ Storefront `globals.css` `:root` binding is EXACTLY: `--font-latin: "Geist"; --font-arabic-family: "IBM Plex Sans Arabic";` (these reproduce today's effective values: the old stack was `var(--font-geist, "Geist")` with `--font-geist` unset on storefront, and the old Arabic default was Plex). Do NOT bind `--font-display-family` on storefront (no storefront code uses `font-display`). Do not touch `packages/storefront-content/src/fonts.ts` or its tests.
- _Finding 5 — lock tests in this task._
  (a) `brand-mark.test.tsx` additionally asserts `viewBox="0 0 64 64"` and that the svg class contains `size-7` by default.
  (b) NEW `apps/admin-web/src/app/icon.test.ts`: reads `icon.svg` with `node:fs` and asserts the literal strings `viewBox="0 0 64 64"`, `rx="14"`, `fill="#b8451d"`, `translate(6 6) scale(.81)`, two `fill="#ffffff"` rects with the bento geometry, two `fill="#f9d5c6"` circles (`cx="17" cy="19" r="9"`, `cx="47" cy="45" r="9"`).
  (c) NEW `apps/admin-web/src/app/brand-fonts.test.ts`: reads `globals.css` and asserts it declares `--font-latin: "Plus Jakarta Sans"`, `--font-arabic-family: "Zain"`, `--font-display-family: "Baloo Bhaijaan 2"` and the `h1 { font-family: var(--font-display); }` rule; reads `layout.tsx` and asserts it imports `@fontsource/plus-jakarta-sans/400.css`, `@fontsource/zain/400.css`, `@fontsource/baloo-bhaijaan-2/600.css`.
  (d) `packages/ui/src/components/ui/primitives.test.tsx`: add a test that a default `Button` and an `size="icon"` Button both have class `rounded-full` and not `rounded-xl`.
  Each new test file carries the `LOCKED BY OWNER … docs/ui/BRAND_LOCK.md` header comment.
- _Finding 4._ Task 2 owns the final check: `git grep -n -i "635bff" -- ':!docs'` → only the arbitrary-input fixtures (`color.test.ts`, `form-controls.test.tsx`, `services/theme/src/domain/theme.test.ts`) remain; list them.

---

### Task 3 — Docs + CODEOWNERS (implementer: terra)

**Files:** `docs/ui/MORBEH_DESIGN_SYSTEM.md`, NEW `docs/ui/BRAND_LOCK.md`, NEW `.github/CODEOWNERS`.

**Steps**

1. `BRAND_LOCK.md` (≤80 lines): states the owner decision and date; the locked items (palette tables copied from this plan, fonts, radius, logo geometry, favicon); the enforcing files (`packages/design/src/brand-lock.test.ts`, `apps/admin-web/src/components/brand-mark.test.tsx`, CODEOWNERS); the rule "a change needs an explicit owner order; agents must refuse or ask"; the change procedure (owner order → update tables + both lock tests in the same commit → owner review).
2. `MORBEH_DESIGN_SYSTEM.md`: update §1 rule 1 ("Neutral first, terracotta as punctuation"), §3 typography table (Plus Jakarta Sans / Zain / Baloo Bhaijaan 2 display, Zain weight note), §4.1 ramp table (new values and roles), §4.2 (warm sand + night ramps), §4.3 status table, §4.4 add `brandSecondary`/`brandIconAccent`, §6 radius (cards 22, buttons pill), §12 dark mode (ink labels on lighter fills). Add a banner under the title linking `BRAND_LOCK.md`. Do not restructure other sections.
3. `.github/CODEOWNERS`: `packages/design/ @AbdoNabi1`, `apps/admin-web/src/components/brand-mark.tsx @AbdoNabi1`, `apps/admin-web/src/app/icon.svg @AbdoNabi1`, `docs/ui/BRAND_LOCK.md @AbdoNabi1`.
4. Commit: `docs(design): document the locked Nusuj brand`.

**Check:** `git grep -n -i "635bff\|Geist\|slate" docs/ui/MORBEH_DESIGN_SYSTEM.md` → no stale brand claims (a historical mention in a changelog line is fine; say which).

**Amendments (binding)** — the amendment wins over the task text above.

- _Plan review 1, finding 6._ `.github/CODEOWNERS` lists `@AbdoNabi1` for: `/packages/design/`, `/packages/ui/src/components/ui/button.tsx`, `/packages/ui/src/components/ui/primitives.test.tsx`, `/apps/admin-web/src/components/brand-mark.tsx`, `/apps/admin-web/src/components/brand-mark.test.tsx`, `/apps/admin-web/src/app/icon.svg`, `/apps/admin-web/src/app/icon.test.ts`, `/apps/admin-web/src/app/brand-fonts.test.ts`, `/apps/admin-web/src/app/globals.css`, `/apps/admin-web/src/app/layout.tsx`, `/apps/storefront/src/app/globals.css`, `/docs/ui/BRAND_LOCK.md`, `/AGENTS.md`, `/.github/CODEOWNERS`.
  NEW root `AGENTS.md` (≤25 lines): a "Brand lock" section — Morbeh's brand is Nusuj, locked by the owner on 2026-11-19; agents must not change colours, fonts, radii, logo, favicon or button shape, nor the lock tests, without an explicit owner order; they refuse or ask; details in `docs/ui/BRAND_LOCK.md`. Nothing else in that file.
  `BRAND_LOCK.md` lists all lock test files from the CODEOWNERS list and states plainly that CODEOWNERS only _requests_ the owner's review unless branch protection requires code-owner approval (owner's manual setting).
- _Finding 7._ §4.4 is rewritten to mirror the COMPLETE semantic table of this plan (all 45 keys, light and dark, primitive step + hex), not appended to. Also update: §3 weights wording ("only three" → 400/500/600 UI + 700/800 display; Zain lacks 500/600 → renders 400/700), and the Arabic statement in §14 (Plex → Zain for the dashboard; storefront keeps the merchant's font). Keep section structure and unrelated content.
  Check command (replaces the old one): `git grep -n -i "635bff\|geist\|slate\|only three\|IBM Plex" docs/ui/MORBEH_DESIGN_SYSTEM.md` → every remaining hit is either the storefront/merchant-font context or a historical note; list each with its reason.

---

## Acceptance (Opus, after Task 3)

Run admin-web dev server, open `/login` and the dashboard shell in EN and AR, light and dark; screenshot and compare against demo column A (colours, fonts, bento, pill buttons, favicon). Run the full test commands of Tasks 1–2 myself.
