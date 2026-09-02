/**
 * The one focus treatment in Lumo: a 2px `--ring` outline, offset so it reads clearly on
 * every surface. Every interactive primitive composes this — a focus style is never
 * re-invented per component, and it is never removed.
 */
export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * Inset variant, for controls that sit flush inside a bordered container (table rows,
 * list items, sidebar links) where an offset ring would be clipped.
 */
export const focusRingInset =
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";
