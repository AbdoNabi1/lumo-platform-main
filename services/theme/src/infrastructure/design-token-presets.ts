import { colors, typography } from "@platform/design";
import { ThemeVariables } from "../domain/value-objects/theme-variables";

/**
 * The theme presets built from the Morbeh `@platform/design` tokens (read-only) — never duplicates
 * the design system, only maps its shape into `ThemeVariables`.
 */
const PRESETS: Readonly<Record<string, () => ThemeVariables>> = {
  default: () =>
    ThemeVariables.create(
      colors.light,
      { fontSans: typography.fontSans, fontMono: typography.fontMono },
      { root: "14px" },
    ),
  dark: () =>
    ThemeVariables.create(
      colors.dark,
      { fontSans: typography.fontSans, fontMono: typography.fontMono },
      { root: "14px" },
    ),
};

export function resolveDesignTokenPreset(presetKey: string): ThemeVariables {
  const factory = PRESETS[presetKey] ?? PRESETS.default;
  if (factory === undefined) {
    throw new Error("unreachable: PRESETS.default is always defined");
  }
  return factory();
}
