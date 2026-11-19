# Morbeh Design System

> **Status: canonical.** Morbeh is the platform's single design system. There is no second
> system, no legacy system, and no per-app design language. Every visual decision in this
> repository resolves here.
>
> Ratified 2026-08-08, superseding the frozen admin prototype design system (see
> [DECISIONS.md](../DECISIONS.md) D-011 / D-052).
>
> **Brand: Nusuj — Warm Weave (نسيج). LOCKED BY OWNER on 2026-11-19.** Colours, fonts, radii, the
> logo, the favicon and the button shape change only on an explicit owner order. What is locked,
> what enforces it, and how to change it: [BRAND_LOCK.md](./BRAND_LOCK.md).

**Where it lives**

| Layer                                  | Path                                           | Role                                                     |
| -------------------------------------- | ---------------------------------------------- | -------------------------------------------------------- |
| Tokens (CSS — runtime source of truth) | `packages/design/src/styles.css`               | What the browser renders from                            |
| Tokens (TS mirror)                     | `packages/design/src/{primitives,semantic}.ts` | Programmatic consumers, tests, `services/theme` seeding  |
| Accessibility guard                    | `packages/design/src/contrast.test.ts`         | Asserts the palette's WCAG AA guarantees on every run    |
| Brand lock                             | `packages/design/src/brand-lock.test.ts`       | Pins every locked value; proves CSS and TS are identical |
| Components                             | `packages/ui/src/components/ui/*`              | The only sanctioned way to build a Morbeh surface        |
| Reference implementation               | `apps/admin-web`                               | The Morbeh Dashboard                                     |

---

## 1. Brand principles

Morbeh is **premium, modern, enterprise, minimal, confident, clean, data-oriented**. It is a
commerce operating system, not a template.

Five rules that make a screen look like Morbeh:

1. **Neutral first, terracotta as punctuation.** The interface is overwhelmingly warm sand
   neutral. Morbeh Terracotta marks the primary action, the active location, the focused
   element, and the leading data series — nothing else.
2. **Borders separate, shadows lift.** Hairline borders are the primary separation
   mechanism. Shadows are reserved for surfaces that genuinely float above the page.
3. **Data is the subject.** Chrome recedes. Numbers get the weight, the tabular figures,
   and the space.
4. **Restraint over decoration.** No gradients as texture, no bubble radii, no animation
   that does not report a state change.
5. **Never hard-code a value.** If a component contains a hex, a raw pixel colour, or a
   font stack, it is wrong. Components consume semantic tokens.

---

## 2. Design token architecture

Three layers, one direction of dependency:

```
primitives  ─→  semantic  ─→  components
--lumo-*        --card          bg-card
                --primary       text-primary-foreground
```

- **Primitives** (`--lumo-primary-500`, `--lumo-neutral-200`) are context-free scales.
  Product code may **not** reference them. They exist only to define the semantic layer.
- **Semantic tokens** (`--card`, `--muted-foreground`, `--primary-hover`) answer a _role_
  question. They are what changes between light and dark.
- **Tailwind utilities** are generated from the semantic layer via `@theme inline` in
  `styles.css`, so `bg-card` resolves per-theme at runtime.

Two naming details worth knowing:

- Shadows are stored as `--lumo-shadow-*` and bridged into `--shadow-*` inside
  `@theme inline`. That indirection is what lets `shadow-md` mean something different
  under `.dark`.
- Motion durations live as plain custom properties (`--duration-fast`) and are consumed as
  `duration-(--duration-fast)`, because Tailwind v4 has no `--duration-*` theme namespace.
  Easings do have one (`--ease-*`), so `ease-out` resolves to the Morbeh curve.

---

## 3. Typography

| Script                 | Family                | Slot variable           | Loaded by                                 |
| ---------------------- | --------------------- | ----------------------- | ----------------------------------------- |
| Latin UI               | **Plus Jakarta Sans** | `--font-latin`          | `@fontsource/plus-jakarta-sans` (400–700) |
| Arabic UI              | **Zain**              | `--font-arabic-family`  | `@fontsource/zain` (400, 700, 800)        |
| Display (h1, wordmark) | **Baloo Bhaijaan 2**  | `--font-display-family` | `@fontsource/baloo-bhaijaan-2` (600–800)  |
| Code / identifiers     | system mono stack     | —                       | —                                         |

None of the fonts is fetched at build time; all ship as local files. The apps bind the loaded
families to the slot variables; the token stylesheet falls back to system stacks when a slot is
empty. The storefront binds its own slots (Geist for Latin, IBM Plex Sans Arabic for Arabic) and
renders shop typography in the merchant-chosen families — the Nusuj fonts apply to the
dashboard and auth pages, not to merchant storefronts.

**Weights.** UI text uses 400 / 500 / 600; display text (the brand wordmark) uses 700 / 800.

| Weight        | Use                                                          |
| ------------- | ------------------------------------------------------------ |
| 400 Regular   | body, descriptions, table content                            |
| 500 Medium    | labels, navigation, buttons, metadata                        |
| 600 Semibold  | headings, KPI values, section titles                         |
| 700–800 Bold+ | display: brand wordmark (Baloo Bhaijaan 2 loads 600/700/800) |

Zain ships 200 / 300 / 400 / 700 / 800 / 900 only, so in Arabic weight 500 renders as 400 and
600 as 700. This is accepted; weights are never faked. Page titles (`h1`) take the display
family from one base rule in the admin app; their weight stays with each page's own utility.

**Scale** (`font-size` / `line-height`), base is 14px:

| Token       | Size | Line | Typical use                        |
| ----------- | ---- | ---- | ---------------------------------- |
| `text-xs`   | 12   | 16   | badges, hints, table headers       |
| `text-sm`   | 13   | 18   | dense metadata                     |
| `text-base` | 14   | 20   | body, table cells, buttons, inputs |
| `text-md`   | 15   | 22   | page subtitle                      |
| `text-lg`   | 16   | 24   | card titles                        |
| `text-xl`   | 18   | 26   | dialog titles                      |
| `text-2xl`  | 20   | 28   | section titles                     |
| `text-3xl`  | 24   | 32   | KPI values                         |
| `text-4xl`  | 30   | 38   | page title                         |

**Arabic** does not override `font-family` per element. `:root:lang(ar)` redefines
`--font-sans` itself, so everything that already resolves through the token switches
family at once. `--font-display` is deliberately not overridden: Baloo Bhaijaan 2 carries
Arabic glyphs. An Arabic island inside an English page (`[lang="ar"]`) is handled separately.

---

## 4. Colour

### 4.1 Morbeh Primary — terracotta

Canonical brand colour: **`#b8451d`** (hue ≈15°), scale step `500`.

| Step    | Value         | Role                                                           |
| ------- | ------------- | -------------------------------------------------------------- |
| 50      | `#fdf3ee`     | faintest wash                                                  |
| 100     | `#fae4d8`     | `--primary-subtle` (light) — active nav, accent badge          |
| 200     | `#f5c9b4`     | `--primary-active` (dark); canvas glow (light)                 |
| 300     | `#f5916e`     | `--primary-hover` (dark), `--primary-subtle-foreground` (dark) |
| 400     | `#ef7b52`     | `--primary` / `--ring` / chart series 1 (dark)                 |
| **500** | **`#b8451d`** | `--primary` / `--ring` / chart series 1 (light) — brand fill   |
| 600     | `#9a3714`     | `--primary-hover` (light)                                      |
| 700     | `#7e2d10`     | `--primary-active`, `--primary-subtle-foreground` (light)      |
| 800     | `#64240d`     | canvas glow (dark)                                             |
| 900     | `#4c1c0b`     |                                                                |
| 950     | `#3a1c10`     | `--primary-subtle` (dark)                                      |

`500` is the light-theme fill: it clears 5.37:1 against a white label (600 clears 7.17:1). Dark
mode does not reuse it: dark fills use the lighter `400` step with an ink label
(`on-primary-ink`, `#1a1512`, 6.57:1), the same ink that labels the dark destructive fill.

### 4.2 Neutral — warm sand, night, and brand tones

`neutral` is the light-side ramp (steps 0–950): `#ffffff` · `#fcf8f3` · `#f3e9de` · `#e8ded3` ·
`#d5c8ba` · `#a1968b` · `#8a7f75` · `#5d636a` · `#3f3a36` · `#2b2724` · `#212529` · `#141210`.

`night` is the dark theme's surfaces and text. It is authored for dark, not an inversion of
`neutral`, and only has the steps dark uses:

| Step | 50        | 300       | 400       | 500       | 700       | 800       | 850       | 900       | 950       |
| ---- | --------- | --------- | --------- | --------- | --------- | --------- | --------- | --------- | --------- |
| Hex  | `#faf6f2` | `#d3c9bf` | `#b5aca3` | `#8c8279` | `#3f3832` | `#342e29` | `#29231e` | `#1e1b18` | `#141210` |

`brand` holds the logo's two-tone, exposed as `--brand-secondary` and `--brand-icon-accent`.
These are brand-lock values, never UI accents:

| Tone         | Light     | Dark      |
| ------------ | --------- | --------- |
| `secondary`  | `#4c362e` | `#dec8b4` |
| `iconAccent` | `#f9d5c6` | `#f9d5c6` |

### 4.3 Semantic status

| Role    | Light primary / soft / strong     | Dark primary / soft / strong      |
| ------- | --------------------------------- | --------------------------------- |
| Success | `#1f8a57` / `#ebf7f0` / `#1a6e47` | `#2fa36b` / `#142b20` / `#5bd998` |
| Warning | `#c77a0a` / `#fef4e5` / `#8e5005` | `#d9901c` / `#2c2111` / `#f3b753` |
| Error   | `#c0263a` / `#fcebec` / `#9b1c2e` | `#e5484d` / `#3a1518` / `#ff8a8f` |
| Info    | `#3a6ea5` / `#edf4fa` / `#2f5882` | `#4a86c5` / `#162331` / `#83b5e8` |

Meaning is fixed platform-wide — admin, storefront, orders, payments, inventory,
checkout, analytics, customer areas all use the same mapping:

- **success** — settled, healthy, in stock, paid
- **warning** — needs attention, low stock, scheduled
- **error/destructive** — failed, reversed, refunded, out of stock
- **info** — in progress, processing

### 4.4 Semantic token reference

All 45 semantic keys, mirrored from `packages/design/src/semantic.ts` and `styles.css`
(`brand-lock.test.ts` pins every row). The cell shows the primitive step and its value.

| Token                             | Light                            | Dark                             |
| --------------------------------- | -------------------------------- | -------------------------------- |
| `--background`                    | neutral-50 `#fcf8f3`             | night-950 `#141210`              |
| `--foreground`                    | neutral-900 `#212529`            | night-50 `#faf6f2`               |
| `--card`                          | neutral-0 `#ffffff`              | night-900 `#1e1b18`              |
| `--card-foreground`               | neutral-900 `#212529`            | night-50 `#faf6f2`               |
| `--popover`                       | neutral-0 `#ffffff`              | night-850 `#29231e`              |
| `--popover-foreground`            | neutral-900 `#212529`            | night-50 `#faf6f2`               |
| `--surface`                       | neutral-100 `#f3e9de`            | night-850 `#29231e`              |
| `--surface-foreground`            | neutral-900 `#212529`            | night-50 `#faf6f2`               |
| `--muted`                         | neutral-100 `#f3e9de`            | night-850 `#29231e`              |
| `--muted-foreground`              | neutral-600 `#5d636a`            | night-400 `#b5aca3`              |
| `--subtle-foreground`             | neutral-400 `#a1968b`            | night-500 `#8c8279`              |
| `--secondary`                     | neutral-100 `#f3e9de`            | night-850 `#29231e`              |
| `--secondary-foreground`          | neutral-700 `#3f3a36`            | night-300 `#d3c9bf`              |
| `--accent`                        | neutral-100 `#f3e9de`            | night-850 `#29231e`              |
| `--accent-foreground`             | neutral-900 `#212529`            | night-50 `#faf6f2`               |
| `--border`                        | neutral-200 `#e8ded3`            | night-800 `#342e29`              |
| `--border-strong`                 | neutral-300 `#d5c8ba`            | night-700 `#3f3832`              |
| `--input`                         | neutral-500 `#8a7f75`            | night-500 `#8c8279`              |
| `--ring`                          | primary-500 `#b8451d`            | primary-400 `#ef7b52`            |
| `--primary`                       | primary-500 `#b8451d`            | primary-400 `#ef7b52`            |
| `--primary-foreground`            | neutral-0 `#ffffff`              | on-primary-ink `#1a1512`         |
| `--primary-hover`                 | primary-600 `#9a3714`            | primary-300 `#f5916e`            |
| `--primary-active`                | primary-700 `#7e2d10`            | primary-200 `#f5c9b4`            |
| `--primary-subtle`                | primary-100 `#fae4d8`            | primary-950 `#3a1c10`            |
| `--primary-subtle-foreground`     | primary-700 `#7e2d10`            | primary-300 `#f5916e`            |
| `--success`                       | status.success.primary `#1f8a57` | status.success.primary `#2fa36b` |
| `--success-subtle`                | status.success.soft `#ebf7f0`    | status.success.soft `#142b20`    |
| `--success-foreground`            | status.success.strong `#1a6e47`  | status.success.strong `#5bd998`  |
| `--warning`                       | status.warning.primary `#c77a0a` | status.warning.primary `#d9901c` |
| `--warning-subtle`                | status.warning.soft `#fef4e5`    | status.warning.soft `#2c2111`    |
| `--warning-foreground`            | status.warning.strong `#8e5005`  | status.warning.strong `#f3b753`  |
| `--destructive`                   | status.error.primary `#c0263a`   | status.error.primary `#e5484d`   |
| `--destructive-foreground`        | neutral-0 `#ffffff`              | on-primary-ink `#1a1512`         |
| `--destructive-subtle`            | status.error.soft `#fcebec`      | status.error.soft `#3a1518`      |
| `--destructive-subtle-foreground` | status.error.strong `#9b1c2e`    | status.error.strong `#ff8a8f`    |
| `--info`                          | status.info.primary `#3a6ea5`    | status.info.primary `#4a86c5`    |
| `--info-subtle`                   | status.info.soft `#edf4fa`       | status.info.soft `#162331`       |
| `--info-foreground`               | status.info.strong `#2f5882`     | status.info.strong `#83b5e8`     |
| `--chart-1`                       | primary-500 `#b8451d`            | primary-400 `#ef7b52`            |
| `--chart-2`                       | neutral-500 `#8a7f75`            | night-400 `#b5aca3`              |
| `--chart-3`                       | status.info.primary `#3a6ea5`    | status.info.strong `#83b5e8`     |
| `--chart-4`                       | status.warning.primary `#c77a0a` | status.warning.strong `#f3b753`  |
| `--chart-5`                       | status.success.primary `#1f8a57` | status.success.strong `#5bd998`  |
| `--brand-secondary`               | brand.secondary `#4c362e`        | brand.secondary `#dec8b4`        |
| `--brand-icon-accent`             | brand.iconAccent `#f9d5c6`       | brand.iconAccent `#f9d5c6`       |

`--input` is deliberately darker than `--border`: a form-control boundary must clear 3:1
against its surface (WCAG 1.4.11); a decorative divider need not.

---

## 5. Spacing

Strict **4px grid**. The ten allowed steps, and the Tailwind utility that produces each:

| px      | 4   | 8   | 12  | 16  | 24  | 32  | 40   | 48   | 64   | 80   |
| ------- | --- | --- | --- | --- | --- | --- | ---- | ---- | ---- | ---- |
| utility | `1` | `2` | `3` | `4` | `6` | `8` | `10` | `12` | `16` | `20` |

- Component internals → 8 / 12 / 16
- Section spacing → 24 / 32 / 48
- Page-level spacing → 32 / 48 / 64

Arbitrary values (`p-[13px]`) are not permitted.

---

## 6. Radius

| Token          | Value  | Use                                  |
| -------------- | ------ | ------------------------------------ |
| `rounded-xs`   | 4px    | keyboard hints, micro chips          |
| `rounded-sm`   | 6px    | menu items, small controls           |
| `rounded-md`   | 8px    | dropdowns                            |
| `rounded-lg`   | 12px   |                                      |
| `rounded-xl`   | 16px   | inputs                               |
| `rounded-2xl`  | 22px   | cards, KPI tiles                     |
| `rounded-3xl`  | 28px   | dialogs, large surfaces              |
| `rounded-full` | 9999px | **buttons (pills)**, badges, avatars |

Buttons are pills, including the icon button, which is a circle. The storefront re-declares the
radius scale through `--shop-radius-*` for branded shops; its fallbacks are its own.

---

## 7. Elevation

| Token       | Use                                     |
| ----------- | --------------------------------------- |
| `shadow-sm` | barely-raised affordances               |
| `shadow-md` | `Card variant="elevated"` — opt-in only |
| `shadow-lg` | dropdown, tooltip                       |
| `shadow-xl` | dialog, drawer                          |

Light shadows use the warm ink `rgb(33 29 26 / α)`. Two brand-tinted shadows, `shadow-card`
(`0 1px 2px 0 rgb(184 69 29 / 0.05), 0 12px 28px -8px rgb(76 54 46 / 0.10)`) and
`shadow-card-hover` (`0 2px 4px 0 rgb(184 69 29 / 0.07), 0 16px 36px -8px rgb(76 54 46 / 0.16)`),
are the resting and hover elevation of a card. If everything else is elevated, nothing is.

---

## 8. Icons

**Lucide** (`lucide-react`) — outline, rounded, consistent stroke, `currentColor`. It is the
only icon library in the repository; mixing sets is prohibited.

| Size            | Use                                         |
| --------------- | ------------------------------------------- |
| 16px (`size-4`) | inline with text, small buttons, menu items |
| 20px (`size-5`) | default — buttons, nav items                |
| 24px (`size-6`) | large affordances                           |
| 28px (`size-7`) | brand mark (default)                        |

Default stroke width **1.75**. Decorative icons carry `aria-hidden="true"`; icon-only
controls carry an `aria-label`.

---

## 9. Motion

| Token                | Duration | Use                                     |
| -------------------- | -------- | --------------------------------------- |
| `--duration-instant` | 100ms    | menu item highlight                     |
| `--duration-fast`    | 150ms    | colour transitions, hover, focus        |
| `--duration-normal`  | 200ms    | dialog/dropdown entry                   |
| `--duration-medium`  | 300ms    | larger surface transitions              |
| `--duration-slow`    | 400ms    | full-page or multi-element choreography |

Easings: `ease-out` (entering), `ease-in` (leaving), `ease-in-out` (moving between states).

Four named animations exist — `animate-fade-in`, `animate-fade-out`, `animate-surface-in`,
`animate-surface-out` — and nothing else. Motion reports a state change or it does not
ship.

`prefers-reduced-motion: reduce` collapses every animation and transition to 1ms, globally,
in the token stylesheet. No component opts out.

---

## 10. Components

Canonical primitives live in `@platform/ui`. Implemented and validated:

| Component                                    | Notes                                                                                   |
| -------------------------------------------- | --------------------------------------------------------------------------------------- |
| `Button`                                     | 6 variants × 4 sizes × 6 states                                                         |
| `Card`                                       | + Header/Title/Description/Content/Footer, 6 variants                                   |
| `Badge`                                      | 7 variants carrying the status contract                                                 |
| `Input`, `Label`                             | label association is mandatory                                                          |
| `Table`                                      | + Header/Body/Footer/Row/Head/Cell/Caption, self-scrolling                              |
| `Tabs`                                       | Radix — roving tabindex, `aria-selected`                                                |
| `Dialog`                                     | Radix — focus trap, restore, sibling inertness; `position="inline-start"` is the drawer |
| `DropdownMenu`                               | Radix — typeahead, arrow keys, `aria-expanded`                                          |
| `CommandSearch`                              | combobox + listbox, `aria-activedescendant`                                             |
| `Avatar`, `Separator`, `Skeleton`, `Tooltip` |                                                                                         |
| `ThemeToggle`                                | three-way radiogroup: light / system / dark                                             |

Not yet built (next expansion): `Select`, `Checkbox`, `Radio`, `Switch`, `Alert`, `Toast`,
`Breadcrumb`, `Pagination`, `DatePicker`.

### 10.1 Button

| Variant       | Appearance                                                                       |
| ------------- | -------------------------------------------------------------------------------- |
| `primary`     | `--primary` fill, `--primary-foreground` label. **At most one per page header.** |
| `secondary`   | neutral fill                                                                     |
| `outline`     | card fill, `--border-strong` boundary                                            |
| `ghost`       | transparent until hover                                                          |
| `destructive` | `--destructive` fill                                                             |
| `link`        | text + underline on hover                                                        |

Sizes `sm` (32px) · `md` (36px) · `lg` (40px) · `icon` (36² circle). All buttons are pills (`rounded-full`). States: default,
hover, active, focus, disabled, loading (`loading` disables the button, swaps in a spinner,
and sets `aria-busy`).

### 10.2 Card

```
Card
 ├── CardHeader   ← wraps; holds CardTitle + a trailing action
 │    ├── CardTitle        (renders <h3>; override with `as`)
 │    └── CardDescription
 ├── CardContent
 └── CardFooter
```

Variants: `default` (card fill, hairline border, 22px radius, soft `shadow-card`), `bordered`,
`elevated`, `interactive` (hover + focus affordance), `kpi`, `compact`.

### 10.3 Usage rules

- Never hard-code a colour, radius, shadow, duration, or spacing value in a component.
- Never re-implement a focus style — compose `focusRing` / `focusRingInset` from
  `@platform/ui`.
- Never introduce a second icon library.
- New primitives go in `@platform/ui`, not in an app.

---

## 11. Layout & responsiveness

Validated at **1440 · 1280 · 1024 · 768 · 390**.

| Width    | Sidebar                                | KPI row | Tables          |
| -------- | -------------------------------------- | ------- | --------------- |
| ≥1280    | 260px, labelled                        | 4-up    | inline          |
| 1024     | 260px, labelled                        | 2-up    | inline          |
| 768–1023 | 76px icon rail, labels `sr-only`       | 2-up    | scroll in place |
| <768     | removed from layout; opens as a drawer | 1-up    | scroll in place |

**No horizontal page overflow, ever.** This is enforced by construction, not by
`overflow-x: hidden` — that would hide the bug rather than fix it. Two rules make it hold:

1. Wide content scrolls inside its own container. `Table` supplies a labelled,
   keyboard-reachable `overflow-x: auto` region automatically.
2. Grid and flex children carry `min-w-0`. A grid item defaults to `min-width: auto`,
   which lets a wide child push the whole page sideways instead of scrolling.

---

## 12. Dark mode

Three modes: **light**, **dark**, **system** (default). `next-themes` puts `.dark` on
`<html>`.

Dark is **authored**, not inverted:

- Surfaces step _up_ in lightness as they come forward, on the warm `night` ramp:
  `background` (night-950) → `card` (900) → `popover`/`surface` (850).
- Borders are chosen for contrast against `--card`, not against the canvas.
- Status _text_ uses the lighter ramp step (`#5bd998`, not `#1a6e47`).
- The primary fill is the lighter `primary-400` (`#ef7b52`), not the light theme's `500`, and
  its label is the dark ink `#1a1512` rather than white. The destructive fill takes the same
  ink label.
- Dark shadow values are unchanged by the brand: near-black with higher alpha, because a
  light-tinted shadow is invisible on a dark surface.

Verified in dark: cards, tables, inputs, dialogs, navigation, badges, charts, buttons.

---

## 13. Accessibility

Target: **WCAG 2.1 Level AA**.

**Colour contrast is tested, not asserted.** `packages/design/src/contrast.test.ts` runs 61
tests across both themes covering body/muted/secondary/accent text, every button
state, every badge pair, input boundaries, focus rings, and all five chart series. A token
change that breaks a guarantee fails the suite.

Structural requirements:

- Keyboard reachable throughout; visible focus on every interactive element via the single
  shared `focusRing`.
- Semantic HTML: real `<button>`, `<a>`, `<table>`, `<nav>`, `<main>`, `<header>`,
  `<footer>`. Navigation groups are separate `<nav>` landmarks, never headings — an `<h2>`
  before the page `<h1>` is a hierarchy bug.
- One `<h1>` per page; heading levels do not skip.
- Every input has an associated `<label>`. A placeholder is not a label.
- Dialogs trap focus, restore it to the trigger, and make the rest of the page inert.
- Tables use `<th scope>`, and the scroll region is focusable and labelled.
- Meaning never rests on colour alone — deltas carry an arrow icon and a sign, stock states
  carry text, chart series are repeated in a legend with values.
- Charts are `role="img"` with a summary label, plus the same data in a visually hidden
  list.

---

## 14. RTL and localisation

`<html dir>` is the only direction switch. Layout is written with **logical properties** —
`border-e`, `ms-*`, `me-*`, `text-start`, `text-end`, `start-0`, `inset-*` — so there is no
RTL stylesheet and no mirrored component.

- The drawer docks to the **inline start**: left in LTR, right in RTL, from one rule.
- Directional glyphs mirror explicitly (`rtl:-scale-x-100` on a forward arrow).
- Numbers, currency, percentages, dates, and relative times all go through `Intl`, so
  Arabic gets real localisation rather than English strings in a flipped layout.
- **Charts are not mirrored.** A time axis reads left-to-right in both locales; flipping it
  would reverse the meaning of "later". The card, legend, and axis labels around it do
  follow the reading direction.

Verified in Arabic: typography (Zain loads and applies on the dashboard; the storefront keeps the
merchant's chosen Arabic font), spacing, sidebar
side, tables, dialogs, navigation, icon mirroring, alignment, and zero horizontal overflow.

---

## 15. Extending the system

1. Check whether a semantic token already answers the question. Usually one does.
2. If a genuinely new _role_ exists, add it to `semantic.ts` **and** `styles.css` with both
   a light and a dark value, and add its contrast pair to `contrast.test.ts` and its values to
   `brand-lock.test.ts`. Changing an _existing_ brand value is locked: see
   [BRAND_LOCK.md](./BRAND_LOCK.md).
3. New primitives belong in `@platform/ui`, built from tokens, with a test covering their
   semantics and accessible state.
4. Never add a parallel design system, a second token set, or an app-local theme.
