import { neutral, primary, status } from "./primitives";

/**
 * Morbeh Design System — semantic tokens.
 *
 * This is the layer components are allowed to consume. Every entry answers a *role*
 * ("what is a card's background?"), never an appearance ("what is slate-100?").
 *
 * Light and dark are authored independently. Dark is NOT an inversion of light: its
 * surfaces step *up* in lightness as they come forward (background → card → popover),
 * its borders are chosen for contrast against `card` rather than against `background`,
 * and its status text uses the lighter ramp step.
 *
 * Values are flat `string` maps on purpose — `services/theme` seeds merchant themes from
 * them via `ThemeVariables.create()` and requires `Readonly<Record<string, string>>`.
 */
export interface SemanticColors extends Readonly<Record<string, string>> {
  /** Page canvas. */
  readonly background: string;
  readonly foreground: string;
  /** Raised content surface (cards, sidebar, topbar). */
  readonly card: string;
  readonly cardForeground: string;
  /** Floating surface (dropdown, dialog, tooltip). */
  readonly popover: string;
  readonly popoverForeground: string;
  /** Recessed surface (table headers, inset panels, chart plots). */
  readonly surface: string;
  readonly surfaceForeground: string;
  /** De-emphasised fill + the text that may sit on it. */
  readonly muted: string;
  readonly mutedForeground: string;
  /** Non-essential hint text (timestamps, helper copy). Never the only carrier of meaning. */
  readonly subtleForeground: string;
  /** Neutral control fill (secondary buttons, inactive tabs). */
  readonly secondary: string;
  readonly secondaryForeground: string;
  /** Neutral hover/active wash for interactive rows and nav items. */
  readonly accent: string;
  readonly accentForeground: string;
  /** Hairline separation — the primary separation mechanism in Morbeh. */
  readonly border: string;
  readonly borderStrong: string;
  /** Form control boundary. Held at ≥3:1 against its surface (WCAG 1.4.11). */
  readonly input: string;
  readonly ring: string;
  readonly primary: string;
  readonly primaryForeground: string;
  readonly primaryHover: string;
  readonly primaryActive: string;
  readonly primarySubtle: string;
  readonly primarySubtleForeground: string;
  readonly success: string;
  readonly successSubtle: string;
  readonly successForeground: string;
  readonly warning: string;
  readonly warningSubtle: string;
  readonly warningForeground: string;
  readonly destructive: string;
  readonly destructiveForeground: string;
  readonly destructiveSubtle: string;
  readonly destructiveSubtleForeground: string;
  readonly info: string;
  readonly infoSubtle: string;
  readonly infoForeground: string;
  /** Chart series. `1` is the brand line; the rest stay restrained and colour-blind safe. */
  readonly chart1: string;
  readonly chart2: string;
  readonly chart3: string;
  readonly chart4: string;
  readonly chart5: string;
}

const light: SemanticColors = {
  background: neutral[50],
  foreground: neutral[900],
  card: neutral[0],
  cardForeground: neutral[900],
  popover: neutral[0],
  popoverForeground: neutral[900],
  surface: neutral[100],
  surfaceForeground: neutral[900],
  muted: neutral[100],
  mutedForeground: neutral[500],
  subtleForeground: neutral[400],
  secondary: neutral[100],
  secondaryForeground: neutral[700],
  accent: neutral[100],
  accentForeground: neutral[900],
  border: neutral[200],
  borderStrong: neutral[300],
  input: neutral[500],
  ring: primary[500],
  primary: primary[500],
  primaryForeground: neutral[0],
  primaryHover: primary[600],
  primaryActive: primary[700],
  primarySubtle: primary[100],
  primarySubtleForeground: primary[700],
  success: status.light.success.primary,
  successSubtle: status.light.success.soft,
  successForeground: status.light.success.strong,
  warning: status.light.warning.primary,
  warningSubtle: status.light.warning.soft,
  warningForeground: status.light.warning.strong,
  destructive: status.light.error.primary,
  destructiveForeground: neutral[0],
  destructiveSubtle: status.light.error.soft,
  destructiveSubtleForeground: status.light.error.strong,
  info: status.light.info.primary,
  infoSubtle: status.light.info.soft,
  infoForeground: status.light.info.strong,
  chart1: primary[500],
  chart2: neutral[500],
  chart3: status.light.info.primary,
  chart4: status.light.warning.primary,
  chart5: status.light.success.primary,
};

const dark: SemanticColors = {
  background: neutral[950],
  foreground: neutral[50],
  card: neutral[900],
  cardForeground: neutral[50],
  popover: neutral[800],
  popoverForeground: neutral[50],
  surface: neutral[800],
  surfaceForeground: neutral[50],
  muted: neutral[800],
  mutedForeground: neutral[400],
  subtleForeground: neutral[500],
  secondary: neutral[800],
  secondaryForeground: neutral[300],
  accent: neutral[800],
  accentForeground: neutral[50],
  border: neutral[800],
  borderStrong: neutral[700],
  input: neutral[500],
  ring: primary[400],
  // The brand fill is held at #635BFF in both themes: it is the one value that clears AA
  // against a white label while still reading as "Morbeh purple". Dark-mode *text* uses the
  // lighter ramp steps instead (see `primarySubtleForeground` / `ring`).
  primary: primary[500],
  primaryForeground: neutral[0],
  primaryHover: primary[600],
  primaryActive: primary[700],
  primarySubtle: primary[950],
  primarySubtleForeground: primary[300],
  success: status.dark.success.primary,
  successSubtle: status.dark.success.soft,
  successForeground: status.dark.success.strong,
  warning: status.dark.warning.primary,
  warningSubtle: status.dark.warning.soft,
  warningForeground: status.dark.warning.strong,
  destructive: status.dark.error.primary,
  destructiveForeground: neutral[0],
  destructiveSubtle: status.dark.error.soft,
  destructiveSubtleForeground: status.dark.error.strong,
  info: status.dark.info.primary,
  infoSubtle: status.dark.info.soft,
  infoForeground: status.dark.info.strong,
  chart1: primary[400],
  chart2: neutral[400],
  chart3: status.dark.info.strong,
  chart4: status.dark.warning.strong,
  chart5: status.dark.success.strong,
};

/** The two authored themes. `colors.light` / `colors.dark` are the seeds for `services/theme`. */
export const colors = { light, dark } as const;
