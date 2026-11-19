/**
 * Morbeh Design System — primitive scales.
 *
 * These are the raw, context-free values. Nothing in the product may reference them
 * directly: components consume the *semantic* tokens in `./semantic.ts` (exposed as CSS
 * custom properties by `./styles.css`). Primitives exist so the semantic layer — and only
 * the semantic layer — has somewhere to point.
 *
 * Canonical reference: docs/ui/MORBEH_DESIGN_SYSTEM.md
 */

/**
 * Morbeh Primary — the Nusuj terracotta ramp (hue ≈15°). LOCKED BY OWNER (2026-11-19),
 * see docs/ui/BRAND_LOCK.md. `500` is the canonical brand colour; `600`/`700` are the
 * interactive states (both clear WCAG AA against a white label), `300`/`400` are the
 * dark-mode fills and tints (dark fills use the lighter 400 step with ink labels).
 */
export const primary = {
  50: "#fdf3ee",
  100: "#fae4d8",
  200: "#f5c9b4",
  300: "#f5916e",
  400: "#ef7b52",
  500: "#b8451d",
  600: "#9a3714",
  700: "#7e2d10",
  800: "#64240d",
  900: "#4c1c0b",
  950: "#3a1c10",
} as const;

/** Morbeh Neutral — a warm sand ramp (light side). The UI is overwhelmingly built from these. */
export const neutral = {
  0: "#ffffff",
  50: "#fcf8f3",
  100: "#f3e9de",
  200: "#e8ded3",
  300: "#d5c8ba",
  400: "#a1968b",
  500: "#8a7f75",
  600: "#5d636a",
  700: "#3f3a36",
  800: "#2b2724",
  900: "#212529",
  950: "#141210",
} as const;

/**
 * Night — the dark theme's warm surfaces and text. Authored for dark, not an inversion of
 * `neutral`: surfaces step up in lightness (950 canvas → 900 card → 850 popover/recessed).
 */
export const night = {
  50: "#faf6f2",
  300: "#d3c9bf",
  400: "#b5aca3",
  500: "#8c8279",
  700: "#3f3832",
  800: "#342e29",
  850: "#29231e",
  900: "#1e1b18",
  950: "#141210",
} as const;

/** Logo two-tone: the bento's circles (`secondary`) and the app-icon circles (`iconAccent`). */
export const brand = {
  light: { secondary: "#4c362e", iconAccent: "#f9d5c6" },
  dark: { secondary: "#dec8b4", iconAccent: "#f9d5c6" },
} as const;

/** The "on-primary ink": label colour on the lighter dark-theme brand/destructive fills. */
export const onPrimaryInk = "#1a1512";

/**
 * Status ramps. `primary` is the solid/graphic value, `soft` a tinted background,
 * `strong` the text value that sits on `soft`. Light and dark are authored separately —
 * dark is never a mechanical inversion of light.
 */
export const status = {
  light: {
    success: { primary: "#1f8a57", soft: "#ebf7f0", strong: "#1a6e47" },
    warning: { primary: "#c77a0a", soft: "#fef4e5", strong: "#8e5005" },
    error: { primary: "#c0263a", soft: "#fcebec", strong: "#9b1c2e" },
    info: { primary: "#3a6ea5", soft: "#edf4fa", strong: "#2f5882" },
  },
  dark: {
    success: { primary: "#2fa36b", soft: "#142b20", strong: "#5bd998" },
    warning: { primary: "#d9901c", soft: "#2c2111", strong: "#f3b753" },
    error: { primary: "#e5484d", soft: "#3a1518", strong: "#ff8a8f" },
    info: { primary: "#4a86c5", soft: "#162331", strong: "#83b5e8" },
  },
} as const;

/**
 * Spacing — a strict 4px grid. These ten steps are the only allowed values.
 * Component internals use 8/12/16, sections 24/32/48, page chrome 32/48/64.
 */
export const spacing = {
  "4": "4px",
  "8": "8px",
  "12": "12px",
  "16": "16px",
  "24": "24px",
  "32": "32px",
  "40": "40px",
  "48": "48px",
  "64": "64px",
  "80": "80px",
} as const;

/**
 * Border radius. Inputs/dropdowns 16, buttons are pills (`full`), cards 22, large
 * surfaces/modals 28. `2xl`/`3xl` exist for the soft-premium surfaces (cards, KPI tiles, modals) —
 * everything else keeps using the smaller steps.
 */
export const radius = {
  xs: "4px",
  sm: "6px",
  md: "8px",
  lg: "12px",
  xl: "16px",
  "2xl": "22px",
  "3xl": "28px",
  full: "9999px",
} as const;

/**
 * Elevation. Borders are the primary separation mechanism in Morbeh; shadows are secondary
 * and deliberately restrained. `lg`/`xl` are reserved for floating surfaces (dropdown,
 * dialog, drawer, toast). `card` is the soft, brand-tinted shadow that makes a resting
 * card read as gently floating above the canvas — used as the *default* card shadow.
 */
export const elevation = {
  light: {
    sm: "0 1px 2px 0 rgb(33 29 26 / 0.04)",
    md: "0 2px 4px -1px rgb(33 29 26 / 0.06), 0 4px 8px -2px rgb(33 29 26 / 0.06)",
    lg: "0 4px 8px -2px rgb(33 29 26 / 0.06), 0 12px 24px -4px rgb(33 29 26 / 0.08)",
    xl: "0 8px 16px -4px rgb(33 29 26 / 0.08), 0 24px 48px -8px rgb(33 29 26 / 0.12)",
    card: "0 1px 2px 0 rgb(184 69 29 / 0.05), 0 12px 28px -8px rgb(76 54 46 / 0.10)",
    cardHover: "0 2px 4px 0 rgb(184 69 29 / 0.07), 0 16px 36px -8px rgb(76 54 46 / 0.16)",
  },
  dark: {
    sm: "0 1px 2px 0 rgb(2 6 23 / 0.5)",
    md: "0 2px 4px -1px rgb(2 6 23 / 0.6), 0 4px 8px -2px rgb(2 6 23 / 0.5)",
    lg: "0 4px 8px -2px rgb(2 6 23 / 0.6), 0 12px 24px -4px rgb(2 6 23 / 0.55)",
    xl: "0 8px 16px -4px rgb(2 6 23 / 0.7), 0 24px 48px -8px rgb(2 6 23 / 0.6)",
    card: "0 1px 2px 0 rgb(0 0 0 / 0.3), 0 12px 28px -8px rgb(0 0 0 / 0.45)",
    cardHover: "0 2px 4px 0 rgb(0 0 0 / 0.35), 0 16px 36px -8px rgb(0 0 0 / 0.55)",
  },
} as const;

/** Motion. Durations communicate state change; nothing animates for decoration. */
export const motion = {
  duration: {
    instant: "100ms",
    fast: "150ms",
    normal: "200ms",
    medium: "300ms",
    slow: "400ms",
  },
  easing: {
    out: "cubic-bezier(0, 0, 0.2, 1)",
    in: "cubic-bezier(0.4, 0, 1, 1)",
    inOut: "cubic-bezier(0.4, 0, 0.2, 1)",
  },
} as const;

/**
 * Typography. Plus Jakarta Sans for Latin UI, Zain for Arabic UI, Baloo Bhaijaan 2 for display
 * (h1, brand wordmark) — the app is responsible for loading the webfonts and assigning them to
 * `--font-latin` / `--font-arabic-family` / `--font-display-family`; the families below degrade
 * to system stacks when those are absent. Zain ships 200/300/400/700/800/900 only: weight 500
 * renders as 400 and 600 as 700 in Arabic (accepted; never fake weights).
 */
export const typography = {
  fontSans:
    'var(--font-latin, "Plus Jakarta Sans"), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  fontArabic:
    'var(--font-arabic-family, "Zain"), var(--font-latin, "Plus Jakarta Sans"), ui-sans-serif, system-ui, sans-serif',
  fontDisplay:
    'var(--font-display-family, "Baloo Bhaijaan 2"), var(--font-latin, "Plus Jakarta Sans"), ui-sans-serif, system-ui, sans-serif',
  fontMono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  /** 400 body · 500 labels/nav/buttons/metadata · 600 headings/KPI values · 700 display headings. */
  weights: { regular: 400, medium: 500, semibold: 600, bold: 700 },
  /** `[font-size, line-height]`. `base` (14px) is the admin UI default. */
  sizes: {
    xs: ["12px", "16px"],
    sm: ["13px", "18px"],
    base: ["14px", "20px"],
    md: ["15px", "22px"],
    lg: ["16px", "24px"],
    xl: ["18px", "26px"],
    "2xl": ["20px", "28px"],
    "3xl": ["24px", "32px"],
    "4xl": ["30px", "38px"],
  },
} as const;

/** Layout breakpoints the system is validated against. */
export const breakpoints = {
  /** Mobile — sidebar becomes a drawer, cards stack, tables scroll. */
  sm: "640px",
  /** Tablet — sidebar collapses to an icon rail. */
  md: "768px",
  lg: "1024px",
  xl: "1280px",
  "2xl": "1440px",
} as const;
