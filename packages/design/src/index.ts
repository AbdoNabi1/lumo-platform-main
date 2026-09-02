/**
 * `@platform/design` — the Lumo Design System token layer.
 *
 * Lumo is the platform's single canonical design system. There is no second system and no
 * "legacy" system; anything visual in this repository resolves here.
 *
 * The CSS in `./styles.css` is what the apps actually render from. This module mirrors the
 * same values for programmatic consumers (`services/theme` seeds merchant themes from
 * `colors`), and for tests that need to assert on them.
 *
 * Rules of use:
 *   - Components consume **semantic** tokens (`colors.light.card`, `bg-card`, `var(--card)`).
 *   - Primitive scales (`primary`, `neutral`, `status`) exist only to define the semantic
 *     layer. Do not reach past a semantic token into a scale from product code.
 *   - No component may hard-code a hex value.
 *
 * Docs: docs/ui/LUMO_DESIGN_SYSTEM.md
 */

export {
  breakpoints,
  elevation,
  motion,
  neutral,
  primary,
  radius,
  spacing,
  status,
  typography,
} from "./primitives";

export { colors, type SemanticColors } from "./semantic";

export { contrastRatio, meetsContrast, type ContrastLevel } from "./contrast";
