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
 * Morbeh Primary — the brand ramp around `#635BFF` (hue 243°).
 * `500` is the canonical brand colour; `600`/`700` are the interactive states
 * (both clear WCAG AA against white foreground), `300`/`400` are the dark-mode
 * text/link tints.
 */
export const primary = {
  50: "#f2f1ff",
  100: "#e7e5ff",
  200: "#d1cdff",
  300: "#b2abff",
  400: "#8c83ff",
  500: "#635bff",
  600: "#4f46e8",
  700: "#4038c4",
  800: "#352e9e",
  900: "#2e297d",
  950: "#1b1849",
} as const;

/** Morbeh Neutral — a cool (slate) ramp. The UI is overwhelmingly built from these. */
export const neutral = {
  0: "#ffffff",
  50: "#f8fafc",
  100: "#f1f5f9",
  200: "#e2e8f0",
  300: "#cbd5e1",
  400: "#94a3b8",
  500: "#64748b",
  600: "#475569",
  700: "#334155",
  800: "#1e293b",
  900: "#0f172a",
  950: "#020617",
} as const;

/**
 * Status ramps. `primary` is the solid/graphic value, `soft` a tinted background,
 * `strong` the text value that sits on `soft`. Light and dark are authored separately —
 * dark is never a mechanical inversion of light.
 */
export const status = {
  light: {
    success: { primary: "#16a34a", soft: "#dcfce7", strong: "#166534" },
    warning: { primary: "#d97706", soft: "#fef3c7", strong: "#92400e" },
    error: { primary: "#dc2626", soft: "#fee2e2", strong: "#991b1b" },
    info: { primary: "#2563eb", soft: "#dbeafe", strong: "#1e40af" },
  },
  dark: {
    success: { primary: "#16a34a", soft: "#0b2e1b", strong: "#4ade80" },
    warning: { primary: "#d97706", soft: "#34240a", strong: "#fbbf24" },
    error: { primary: "#dc2626", soft: "#3a1416", strong: "#f87171" },
    info: { primary: "#2563eb", soft: "#10233f", strong: "#60a5fa" },
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
 * Border radius. Inputs/dropdowns 16, buttons 16, cards 20, large surfaces/modals 28,
 * pills full. `2xl`/`3xl` exist for the soft-premium surfaces (cards, KPI tiles, modals) —
 * everything else keeps using the smaller steps.
 */
export const radius = {
  xs: "4px",
  sm: "6px",
  md: "8px",
  lg: "12px",
  xl: "16px",
  "2xl": "20px",
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
    sm: "0 1px 2px 0 rgb(15 23 42 / 0.04)",
    md: "0 2px 4px -1px rgb(15 23 42 / 0.06), 0 4px 8px -2px rgb(15 23 42 / 0.06)",
    lg: "0 4px 8px -2px rgb(15 23 42 / 0.06), 0 12px 24px -4px rgb(15 23 42 / 0.08)",
    xl: "0 8px 16px -4px rgb(15 23 42 / 0.08), 0 24px 48px -8px rgb(15 23 42 / 0.12)",
    card: "0 1px 2px 0 rgb(99 91 255 / 0.04), 0 12px 28px -8px rgb(99 91 255 / 0.10)",
    cardHover: "0 2px 4px 0 rgb(99 91 255 / 0.06), 0 16px 36px -8px rgb(99 91 255 / 0.16)",
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
 * Typography. Geist for Latin, IBM Plex Sans Arabic for Arabic — the app is responsible
 * for loading the webfonts and assigning them to `--font-geist` / `--font-arabic`; the
 * families below degrade to system stacks when those are absent.
 */
export const typography = {
  fontSans:
    'var(--font-geist, "Geist"), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  fontArabic:
    'var(--font-arabic, "IBM Plex Sans Arabic"), var(--font-geist, "Geist"), ui-sans-serif, system-ui, sans-serif',
  fontMono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  /** 400 body · 500 labels/nav/buttons/metadata · 600 headings/KPI values/section titles. */
  weights: { regular: 400, medium: 500, semibold: 600 },
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
