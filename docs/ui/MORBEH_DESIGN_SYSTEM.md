# Morbeh Design System

> **Status: canonical.** Morbeh is the platform's single design system. There is no second
> system, no legacy system, and no per-app design language. Every visual decision in this
> repository resolves here.
>
> Ratified 2026-08-08, superseding the frozen admin prototype design system (see
> [DECISIONS.md](../DECISIONS.md) D-011 / D-052).

**Where it lives**

| Layer                                  | Path                                           | Role                                                    |
| -------------------------------------- | ---------------------------------------------- | ------------------------------------------------------- |
| Tokens (CSS — runtime source of truth) | `packages/design/src/styles.css`               | What the browser renders from                           |
| Tokens (TS mirror)                     | `packages/design/src/{primitives,semantic}.ts` | Programmatic consumers, tests, `services/theme` seeding |
| Accessibility guard                    | `packages/design/src/contrast.test.ts`         | Asserts the palette's WCAG AA guarantees on every run   |
| Components                             | `packages/ui/src/components/ui/*`              | The only sanctioned way to build a Morbeh surface       |
| Reference implementation               | `apps/admin-web`                               | The Morbeh Dashboard                                    |

---

## 1. Brand principles

Morbeh is **premium, modern, enterprise, minimal, confident, clean, data-oriented**. It is a
commerce operating system, not a template.

Five rules that make a screen look like Morbeh:

1. **Neutral first, purple as punctuation.** The interface is overwhelmingly cool neutral.
   Morbeh Purple marks the primary action, the active location, the focused element, and the
   leading data series — nothing else.
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

| Script             | Family                   | Loaded by                                        |
| ------------------ | ------------------------ | ------------------------------------------------ |
| Latin              | **Geist**                | `geist` package (self-hosted)                    |
| Arabic             | **IBM Plex Sans Arabic** | `@fontsource/ibm-plex-sans-arabic` (self-hosted) |
| Code / identifiers | system mono stack        | —                                                |

Neither font is fetched at build time; both ship as local files.

**Weights — only three.**

| Weight       | Use                                   |
| ------------ | ------------------------------------- |
| 400 Regular  | body, descriptions, table content     |
| 500 Medium   | labels, navigation, buttons, metadata |
| 600 Semibold | headings, KPI values, section titles  |

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
family at once. An Arabic island inside an English page (`[lang="ar"]`) is handled
separately.

---

## 4. Colour

### 4.1 Morbeh Primary

Canonical brand colour: **`#635BFF`** (hue 243°), scale step `500`.

| Step    | Value         | Role                                                      |
| ------- | ------------- | --------------------------------------------------------- |
| 50      | `#f2f1ff`     | faintest wash                                             |
| 100     | `#e7e5ff`     | `--primary-subtle` (light) — active nav, accent badge     |
| 200     | `#d1cdff`     |                                                           |
| 300     | `#b2abff`     | `--primary-subtle-foreground` (dark)                      |
| 400     | `#8c83ff`     | `--ring` (dark), chart series 1 (dark)                    |
| **500** | **`#635bff`** | `--primary` — brand fill, both themes                     |
| 600     | `#4f46e8`     | `--primary-hover`                                         |
| 700     | `#4038c4`     | `--primary-active`, `--primary-subtle-foreground` (light) |
| 800     | `#352e9e`     |                                                           |
| 900     | `#2e297d`     |                                                           |
| 950     | `#1b1849`     | `--primary-subtle` (dark)                                 |

`500` is held as the fill in **both** themes: it is the step that clears 4.70:1 against a
white label. Dark mode brightens the _text_ uses (300/400), not the fill.

### 4.2 Neutral — cool (slate)

`#ffffff` · `#f8fafc` · `#f1f5f9` · `#e2e8f0` · `#cbd5e1` · `#94a3b8` · `#64748b` ·
`#475569` · `#334155` · `#1e293b` · `#0f172a` · `#020617` (steps 0–950).

### 4.3 Semantic status

| Role    | Light primary / soft / strong     | Dark primary / soft / strong      |
| ------- | --------------------------------- | --------------------------------- |
| Success | `#16a34a` / `#dcfce7` / `#166534` | `#16a34a` / `#0b2e1b` / `#4ade80` |
| Warning | `#d97706` / `#fef3c7` / `#92400e` | `#d97706` / `#34240a` / `#fbbf24` |
| Error   | `#dc2626` / `#fee2e2` / `#991b1b` | `#dc2626` / `#3a1416` / `#f87171` |
| Info    | `#2563eb` / `#dbeafe` / `#1e40af` | `#2563eb` / `#10233f` / `#60a5fa` |

Meaning is fixed platform-wide — admin, storefront, orders, payments, inventory,
checkout, analytics, customer areas all use the same mapping:

- **success** — settled, healthy, in stock, paid
- **warning** — needs attention, low stock, scheduled
- **error/destructive** — failed, reversed, refunded, out of stock
- **info** — in progress, processing

### 4.4 Semantic token reference

| Token                                    | Light                                            | Dark                                                                  |
| ---------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------- |
| `--background`                           | neutral-50                                       | neutral-950                                                           |
| `--foreground`                           | neutral-900                                      | neutral-50                                                            |
| `--card` / `--card-foreground`           | white / neutral-900                              | neutral-900 / neutral-50                                              |
| `--popover`                              | white                                            | neutral-800                                                           |
| `--surface`                              | neutral-100                                      | neutral-800                                                           |
| `--muted-foreground`                     | neutral-500                                      | neutral-400                                                           |
| `--subtle-foreground`                    | neutral-400                                      | neutral-500                                                           |
| `--secondary` / `--secondary-foreground` | neutral-100 / neutral-700                        | neutral-800 / neutral-300                                             |
| `--accent` (hover wash)                  | neutral-100                                      | neutral-800                                                           |
| `--border` / `--border-strong`           | neutral-200 / neutral-300                        | neutral-800 / neutral-700                                             |
| `--input`                                | neutral-500                                      | neutral-500                                                           |
| `--ring`                                 | primary-500                                      | primary-400                                                           |
| `--chart-1…5`                            | primary-500, neutral-500, info, warning, success | primary-400, neutral-400, info-strong, warning-strong, success-strong |

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

| Token          | Value  | Use                                |
| -------------- | ------ | ---------------------------------- |
| `rounded-xs`   | 4px    | keyboard hints, micro chips        |
| `rounded-sm`   | 6px    | inputs, menu items, small controls |
| `rounded-md`   | 8px    | buttons, icon buttons, dropdowns   |
| `rounded-lg`   | 12px   | cards                              |
| `rounded-xl`   | 16px   | dialogs, large surfaces            |
| `rounded-full` | 9999px | badges, pills, avatars             |

---

## 7. Elevation

| Token       | Use                                     |
| ----------- | --------------------------------------- |
| `shadow-sm` | barely-raised affordances               |
| `shadow-md` | `Card variant="elevated"` — opt-in only |
| `shadow-lg` | dropdown, tooltip                       |
| `shadow-xl` | dialog, drawer                          |

Cards are flat by default. If everything is elevated, nothing is.

---

## 8. Icons

**Lucide** (`lucide-react`) — outline, rounded, consistent stroke, `currentColor`. It is the
only icon library in the repository; mixing sets is prohibited.

| Size            | Use                                         |
| --------------- | ------------------------------------------- |
| 16px (`size-4`) | inline with text, small buttons, menu items |
| 20px (`size-5`) | default — buttons, nav items                |
| 24px (`size-6`) | brand mark, large affordances               |

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

Sizes `sm` (32px) · `md` (36px) · `lg` (40px) · `icon` (36² square). States: default,
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

Variants: `default` (white, hairline border, 12px radius, no shadow), `bordered`,
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

- Surfaces step _up_ in lightness as they come forward: `background` (neutral-950) →
  `card` (900) → `popover`/`surface` (800).
- Borders are chosen for contrast against `--card`, not against the canvas.
- Status _text_ uses the lighter ramp step (`#4ade80`, not `#166534`).
- The primary fill stays `#635BFF`; only its text uses become lighter.
- Shadows switch from cool-tinted to near-black with higher alpha, because a light-tinted
  shadow is invisible on a dark surface.

Verified in dark: cards, tables, inputs, dialogs, navigation, badges, charts, buttons.

---

## 13. Accessibility

Target: **WCAG 2.1 Level AA**.

**Colour contrast is tested, not asserted.** `packages/design/src/contrast.test.ts` runs 57
assertions across both themes covering body/muted/secondary/accent text, every button
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

Verified in Arabic: typography (IBM Plex Sans Arabic loads and applies), spacing, sidebar
side, tables, dialogs, navigation, icon mirroring, alignment, and zero horizontal overflow.

---

## 15. Extending the system

1. Check whether a semantic token already answers the question. Usually one does.
2. If a genuinely new _role_ exists, add it to `semantic.ts` **and** `styles.css` with both
   a light and a dark value, and add its contrast pair to `contrast.test.ts`.
3. New primitives belong in `@platform/ui`, built from tokens, with a test covering their
   semantics and accessible state.
4. Never add a parallel design system, a second token set, or an app-local theme.
