# UI Recovery Plan — Forensic Report

**Date:** 2026-08-07
**Scope:** storefront UI, design system, component library, admin prototype
**Repo:** `lumo-platform` (HEAD `1b4ff76`, `origin/main` in sync)
**Verdict:** **Nothing was lost. No UI artifact exists in any branch, commit, snapshot, stash, or orphaned history that is not already present in the current working tree.**

---

## 1. Headline finding

The search recovered **zero** additional UI artifacts. Every UI file that has ever existed in this repository's object database is already checked out at `HEAD`.

The gap you are seeing is **not a loss event**. The entire UI corpus was created in a single commit — `ed3654d feat(infrastructure): complete Sprint 0.2 infrastructure foundation` — and was never grown afterward. Only one UI file has been touched since (`apps/storefront/src/app/page.tsx`, extended by `747bbc7`). Sprints 0.3 through C2-2 built ~40 backend services and never returned to the UI layer.

**Consequence:** there is nothing to restore. The correct next action is to _port_ the frozen prototype forward, not to recover it and not to redesign it.

---

## 2. Search surface covered

| Surface              | Extent searched                                                                                          | UI artifacts found                               |
| -------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Worktrees            | 3 (`lumo-platform`, `lumo-platform-recovery`, `lumo-platform-a0-lockfile-repair`) — one shared object DB | same 11, duplicated                              |
| Local branches       | `main`, `recovery/history-reconstruction`, `reference/working-tree-2026-08-03`                           | 11 each, identical                               |
| Remote branches      | `git ls-remote origin` — only `main` + `reference/working-tree-2026-08-03` exist upstream                | no extra refs                                    |
| Tags                 | 7 (`sprint-0.2` … `sprint-a0-complete`, `sprint-integration-recovery-baseline`)                          | nothing beyond the 11                            |
| Reflogs              | 131 `HEAD` entries, 119 on `main`                                                                        | nothing beyond the 11                            |
| Stash                | `stash@{0}` (lint-staged backup)                                                                         | nothing beyond the 11                            |
| **Dangling commits** | **203** — all `WIP on …` lint-staged/stash backups                                                       | **every one contains exactly the same 11 paths** |
| **Dangling blobs**   | **93** — content-scanned for `className=`, `<div`, `useState`, `@tailwind`, `:root{`, `styled.`          | **zero matches**                                 |
| Dangling trees       | 3                                                                                                        | nothing beyond the 11                            |
| Filesystem           | full sweep of `C:\Users\abdoh\Claude code\Git` excluding `node_modules`/`.git`                           | same 11, per worktree                            |

**Distinct UI paths across the entire object database: 11.** Identical to `HEAD`.

### False lead, ruled out

`lumo-platform/storefrontsrcapp` (untracked, 16,653 bytes) looks like a mangled `apps/storefront/src/app` path. It is **not** UI — it is captured `less` help text from a botched shell redirect. Safe to delete.

---

## 3. Complete inventory of surviving UI artifacts

All paths are live at `HEAD`. All originate from `ed3654d` unless noted.

### 3.1 Admin prototype — the crown jewel, fully intact

| Asset                  | Path                                               | Size         | State                                         |
| ---------------------- | -------------------------------------------------- | ------------ | --------------------------------------------- |
| Frozen admin dashboard | `apps/admin/prototype/admin-dashboard.frozen.html` | 34,812 chars | **complete, all 25 screens verified present** |

Self-contained: 3 `<style>` blocks, 2 `<script>` blocks, 36 CSS component classes, Tabler icon webfont. Header declares it approved 2026-06-28, byte-for-byte frozen, single source of truth.

All 25 screen keys confirmed present in the markup: `dashboard`, `orders`, `products`, `inventory`, `customers`, `analytics`, `funnels`, `utm`, `marketing`, `email`, `whatsapp`, `automations`, `discounts`, `coupons`, `upsells`, `crosssells`, `reviews`, `landing`, `pagebuilder`, `abtest`, `flags`, `users`, `permissions`, `activity`, `settings`.

### 3.2 Design system — intact

| Asset                                           | Path                                            | Size                       |
| ----------------------------------------------- | ----------------------------------------------- | -------------------------- |
| Token module (TS)                               | `packages/design/src/index.ts`                  | full light + dark palettes |
| Token stylesheet (source of truth apps consume) | `packages/design/src/styles.css`                | 111 lines                  |
| Package barrel / config                         | `packages/design/package.json`, `tsconfig.json` | —                          |

Tokens are extracted verbatim from `docs/ui/DESIGN_SYSTEM.md` and marked frozen. Light and dark palettes are both complete (bg, surface, surface2, border, borderStrong, hover, text, textSecondary, textMuted, accent, accentBg, accentText, success, warning, danger + `*Bg` variants).

### 3.3 Component library — intact but **minimal**

| Component                            | Path                                               | Lines |
| ------------------------------------ | -------------------------------------------------- | ----- |
| Button                               | `packages/ui/src/components/ui/button.tsx`         | 39    |
| Card                                 | `packages/ui/src/components/ui/card.tsx`           | 26    |
| Input                                | `packages/ui/src/components/ui/input.tsx`          | 16    |
| Label                                | `packages/ui/src/components/ui/label.tsx`          | 18    |
| ThemeToggle                          | `packages/ui/src/components/theme-toggle.tsx`      | 22    |
| ThemeProvider                        | `packages/ui/src/providers/theme-provider.tsx`     | 20    |
| `cn` helper / barrel / shadcn config | `src/lib/cn.ts`, `src/index.ts`, `components.json` | —     |

**5 components + 1 provider, 141 lines total.** This is a shadcn/ui bootstrap, not a product component library.

### 3.4 Storefront — intact but a **smoke screen only**

| Asset              | Path                                                                         | Lines | Note                                                                          |
| ------------------ | ---------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------- |
| Home page          | `apps/storefront/src/app/page.tsx`                                           | 130   | extended by `747bbc7`                                                         |
| Root layout        | `apps/storefront/src/app/layout.tsx`                                         | 17    |                                                                               |
| Global CSS         | `apps/storefront/src/app/globals.css`                                        | 15    |                                                                               |
| Runtime data layer | `apps/storefront/src/lib/runtime-api.ts`                                     | —     | `getProducts`, `getCategories`, `getCollections`, `getPrices`, `getInventory` |
| Next.js config set | `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `tsconfig.json` | —     |                                                                               |

`page.tsx` documents itself: _"Foundation smoke-screen (Sprint 0.1) — NOT a business page."_ It renders one Card proving tokens + dark mode + the UI package are wired, plus degradable Categories/Collections/Inventory reads.

### 3.5 UI specifications — intact, 575 lines

| Spec              | Path                           | Lines | Covers                                                                                                                           |
| ----------------- | ------------------------------ | ----- | -------------------------------------------------------------------------------------------------------------------------------- |
| Design system     | `docs/ui/DESIGN_SYSTEM.md`     | 182   | colors (light/dark), typography, spacing, radius, shadows, icons, buttons, forms, tables, cards, charts, dark tokens, responsive |
| Admin UI spec     | `docs/ui/ADMIN_UI_SPEC.md`     | 167   | global chrome (`.tbar`/`.side`/`.main`) + all 25 screens + wired global flows                                                    |
| Component library | `docs/ui/COMPONENT_LIBRARY.md` | 89    | CSS primitives, JS builders, behavior helpers, data structures, **shadcn/ui mapping for real implementation**                    |
| Navigation        | `docs/ui/NAVIGATION.md`        | 84    | sidebar groups: Overview, Sell, Measure, Grow, Convert, Build, System                                                            |
| Responsive rules  | `docs/ui/RESPONSIVE_RULES.md`  | 53    | breakpoints incl. ≤560px collapsed behavior                                                                                      |

Supporting: `docs/admin/01-ADMIN_DASHBOARD_SPEC.md` (67), `docs/architecture/25-theme-and-storefront-platform.md` (56), `docs/growth/02-PRODUCT_LAYOUT_BUILDER_SPEC.md` (125).

> `packages/design/src/index.ts` references `docs/ui/README.md` as the contract entry point. **That file does not exist** in any commit — a dangling doc reference, not a lost asset.

---

## 4. What is actually missing (never built, not lost)

| Gap                                                                                       | Evidence                                                                                                                                                    |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Admin app has no React UI at all**                                                      | `apps/admin` at `HEAD` = 99 `.ts` files, 2 `.json`, 1 `.md`, 1 `.html`. Zero `.tsx`. It is a Fastify HTTP backend.                                          |
| The `feat(admin): wire X into the admin app (S1 M*)` commits are **backend route wiring** | `10a6b19` (Experimentation), `3a5ce44` (Recommendations), `48b9d93` (Feature Flags) — all reachable from `main`, all leave the UI file count at exactly 11. |
| **25 admin screens exist only as frozen HTML + spec**                                     | No React implementation ever committed.                                                                                                                     |
| **Storefront has 1 page**                                                                 | No PLP, PDP, cart, checkout, account, or order screens ever existed.                                                                                        |
| **Component library covers ~5 of the primitives** the prototype's 36 CSS classes require  | table, badge, chart, modal, dropdown, tabs, toast, sidebar, topbar all unimplemented.                                                                       |

---

## 5. Recovery plan

Because recovery found nothing to restore, this converts to a **port-forward plan**. It deliberately writes no new design.

### Phase 0 — Lock the reference (no code)

1. Keep `apps/admin/prototype/admin-dashboard.frozen.html` frozen. It remains the single visual source of truth per its own header and `docs/ui/`.
2. Create the missing `docs/ui/README.md` that `packages/design/src/index.ts` already points at, stating the contract: prototype = pixel truth, `docs/ui/*` = written truth, `packages/design` = token truth.
3. Delete the junk file `storefrontsrcapp`.

### Phase 1 — Extract, don't invent

Everything below is a **transcription** of assets that already exist. No visual decisions are open.

4. Extract the prototype's 36 CSS component classes into `packages/ui`, one component per class, mapping through the table already written in `docs/ui/COMPONENT_LIBRARY.md` §5 (shadcn/ui mapping — "render must stay identical").
5. Extend `packages/design` only if a token used by the prototype is absent from `styles.css`. Diff first; do not add tokens speculatively.
6. Build the global chrome (`.tbar`, `.side`, `.main`) from `ADMIN_UI_SPEC.md` §2 + `NAVIGATION.md` §1 sidebar groups.

### Phase 2 — Admin screens, spec-ordered

7. Port the 25 screens in `ADMIN_UI_SPEC.md` §3 order. Each screen already has a spec section and a rendered reference in the frozen HTML — implement against both, screen by screen.
8. Wire each screen to the admin backend routes that already exist in `apps/admin/src/http/` (99 `.ts` files are waiting for consumers).
9. Apply `RESPONSIVE_RULES.md` including the ≤560px collapsed sidebar.

### Phase 3 — Storefront

10. Keep `page.tsx` as the smoke screen or retire it explicitly; it is labelled not-a-business-page.
11. Build commerce screens on `runtime-api.ts`, which already exposes products, categories, collections, prices, inventory.

### Guardrails

- **No UI may be written before Phase 0–1.** A usable implementation _does_ exist (frozen prototype + tokens + shadcn base) — so new UI must be a port, never a redesign.
- Any pixel deviation from the frozen prototype requires explicit approval, per the prototype header and `ADMIN_UI_SPEC.md` §5.
- `ADMIN_UI_SPEC.md` §5 and `NAVIGATION.md` §4 enumerate what is deliberately _not_ in the frozen UI — treat those as out of scope absent approval.

---

## 6. Gap analysis — prototype vs. implemented (Phase 1 input)

Measured directly from the frozen prototype's CSS against `packages/design` and `packages/ui`.

### 6.1 Design tokens — effectively complete ✅

|                                                       | Count                  |
| ----------------------------------------------------- | ---------------------- |
| Custom properties in prototype                        | 21                     |
| Custom properties in `packages/design/src/styles.css` | 69                     |
| **Prototype tokens missing from the design package**  | **1 — `--font-voice`** |

The design package is a faithful **superset**. Every brand token (`--ac`, `--acb`, `--act`, `--am`, `--amb`, `--bd`, `--bds`, `--bg`, `--gr`, `--grb`, `--hov`, `--rd`, `--rdb`, `--surface`, `--surface2`, `--tx`, `--tx2`, `--tx3`) is present verbatim in both light and dark, plus a correctly-mapped shadcn semantic layer (`--primary: var(--ac)`, `--card: var(--surface)`, `--border: var(--bd)`, …) and a Tailwind v4 `@theme inline` bridge.

The radius scale is already prototype-accurate: `--radius-md: 0.5rem` (8px) matches `.btn`; `--radius-lg: 0.75rem` (12px) matches `.card`.

**Action: add `--font-voice` only. Do not touch anything else in this file.**

### 6.2 Components — 32 classes specified, 4 have counterparts, none are render-accurate ⚠️

The prototype defines **32 distinct component classes**. `packages/ui` ships **5 components + 1 provider**.

**Present, but stock shadcn — geometry does not match the prototype.** `COMPONENT_LIBRARY.md` §5 requires _"render must stay identical"_, so these need re-skinning, not just wiring:

| Prototype               | Prototype CSS                                                                             | `packages/ui` today                                                                                              | Deviation                                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.btn`                  | `font-size:12.5px; padding:6px 12px; border:1px solid var(--bds)`                         | `Button` `default` = `h-9 px-4 py-2 text-sm bg-primary`, no border                                               | size, padding, **and variant semantics**: prototype's base `.btn` is bordered-on-surface → maps to shadcn `outline`; `.btn.pri` → shadcn `default` |
| `.card` / `.ch` / `.cb` | card `overflow:hidden`; header `padding:11px 14px` + `border-bottom`; body `padding:14px` | `Card` (`rounded-lg`, no overflow), `CardHeader` (`p-4 gap-1`, **no border-bottom**), `CardContent` (`p-4 pt-0`) | header divider missing, paddings differ, no `overflow:hidden`                                                                                      |
| `.tsearch`              | `height:32px; border-radius:8px`                                                          | `Input` `h-9` (36px)                                                                                             | height                                                                                                                                             |
| `.l` (metric label)     | `font-size:12px; color:var(--tx2)`                                                        | `Label`                                                                                                          | size/role                                                                                                                                          |

**Absent entirely — 28 components to port:**

- **Global chrome (7):** `.tbar` topbar · `.brand` · `.lg` logo mark · `.tacts` action cluster · `.ibtn` icon button · `.av` avatar · `.sr-only`
- **Shell & nav (5):** `.body` shell grid (`204px 1fr`, collapses to `56px 1fr`) · `.side` sidebar · `.ng` nav group label · `.ni` nav item (+`.on`) · `.main`
- **Page furniture (2):** `.ph` page header (h1 + subtitle) · `.sp` spacer
- **Controls (3):** `.pill` (+`.on`) · `.sw` switch (+`.on`) · `.tb` toolbar
- **Data display (6):** `.grid`/`.k4` metric grid (4-col → 2-col ≤560px) · `.metric` (+`.l`, `.v`, `.drag`) · `.dl` delta indicator (+`.up`/`.dn`) · `.tbl` table (th/td/last-child/hover) · `.bdg` badge **+ 5 variants** (`.bg` success, `.ba` warning, `.br` danger, `.bn` neutral, `.bc` accent) · `.bar` progress bar
- **Page builder (5):** `.pb` split layout · `.pal` palette · `.pi` palette item · `.cv` drop canvas (+`.over`) · `.blk` block (+`.drag`, `.gp` grip, `.x` remove) · `.lp` landing preview

### 6.3 Revised effort picture

| Layer                       | State                                     | Work                                                  |
| --------------------------- | ----------------------------------------- | ----------------------------------------------------- |
| Design tokens               | ✅ complete                               | add 1 token                                           |
| Component library           | ⚠️ 4/32 present, **0/32 render-accurate** | re-skin 4, port 28                                    |
| Global chrome + nav         | ❌ absent                                 | build from `ADMIN_UI_SPEC.md` §2 + `NAVIGATION.md` §1 |
| 25 admin screens            | ❌ absent (frozen HTML + spec only)       | port screen by screen                                 |
| Storefront commerce screens | ❌ absent                                 | build on existing `runtime-api.ts`                    |

**The token layer is the one part that is genuinely finished.** The claim that a "component library" exists should be read narrowly: it is a shadcn bootstrap with correct _colors_ and _radii_ but prototype-inaccurate _geometry_, covering an eighth of the surface.

---

## 7. Reproducing this audit

```bash
git fsck --lost-found
git log --all --pretty=format:"" --name-only --diff-filter=AMR | grep -E '\.(tsx|jsx|vue|svelte|css|scss|html)$' | sort -u
git ls-remote --heads --tags origin
```

The second command returns **11 paths**. That number is the whole finding.
