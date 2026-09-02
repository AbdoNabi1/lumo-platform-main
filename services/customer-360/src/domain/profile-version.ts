/**
 * A profile's (or profile field's) optimistic-read version — a plain non-negative integer, not a
 * wrapped value object. It carries no behavior beyond "bigger is later", which TS's structural
 * typing already gives every consumer for free; a class here would be ceremony without a
 * corresponding invariant to protect (contrast `Money`, which enforces currency-matching on
 * arithmetic — there is nothing equivalent to enforce on a version number). Named as its own type
 * purely so a signature reads `ProfileVersion`, not an anonymous `number`, matching the Phase 6.2
 * contract's `CustomerProfile` / `ProfileSnapshot` / `ProfileVersion` naming.
 */
export type ProfileVersion = number;

export const INITIAL_PROFILE_VERSION: ProfileVersion = 0;
