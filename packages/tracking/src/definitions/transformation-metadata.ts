/**
 * Transformation Metadata (P5.5) — what a transform *is*, declared once, never executed here.
 *
 * `mapping.ts` owns the one table of transform *functions* (`BUILT_IN_TRANSFORMS`) and the one place
 * they run (`applyMapping`). This file owns a parallel table of transform *facts* — deterministic?
 * idempotent? reversible? — and contains no execution path of its own. It cannot: every function
 * here takes a `TransformMetadata` and returns a fact about it, never a `Scalar`.
 *
 * ## Why this is worth declaring rather than inferring from the function body
 *
 * Two of the built-ins fail a property an author would assume without checking:
 *
 * - `minor_to_major` divides by 100. Applied twice — a mapping profile misconfigured to chain it, or
 *   a retried mapping that re-runs the same field — the second pass divides an already-major value
 *   by 100 again, silently reporting a purchase 100x too small. It is **not idempotent**.
 * - `to_unix_seconds` reinterprets whatever number it receives as milliseconds. Applied to its own
 *   output — seconds, not milliseconds — it produces a timestamp near the epoch. Also **not
 *   idempotent**.
 *
 * A validator or an admin surface that wants to warn on "this profile applies a transform whose
 * result feeds another mapping step" needs `idempotent` as data. Recomputing it by re-reading
 * `mapping.ts`'s function bodies would require a second implementation that *understands* the first
 * — the exact duplication this file exists to avoid — so the fact is written down once, next to the
 * reasoning above, and read everywhere else.
 *
 * ## Coverage is a type error, not a runtime gap
 *
 * `BUILT_IN_TRANSFORM_METADATA` is typed `Readonly<Record<TransformName, TransformMetadata>>`. Adding
 * a transform to `BUILT_IN_TRANSFORMS` without adding its metadata here fails the build — the same
 * discipline `capability.ts` uses for `CapabilityQuery`, applied to a table instead of a union.
 */

import type { TransformName } from "../delivery/mapping";

/** What kind of thing the transform does, for grouping in an admin surface or a docs generator. */
export type TransformCategory =
  "structural" | "normalization" | "unit_conversion" | "type_coercion";

/**
 * Coarse cost band, for a planner or admin surface deciding whether a transform is safe to run
 * inline versus needing to be queued. Every built-in is `trivial` — a synchronous op on one scalar —
 * but the band exists so a registry-declared transform (a lookup, a geocode) has somewhere to say
 * otherwise.
 */
export type TransformCost = "trivial" | "low" | "moderate";

export interface TransformMetadata {
  readonly name: string;
  readonly category: TransformCategory;
  readonly cost: TransformCost;

  /** Same input always produces the same output. Every built-in is; `Math.random`-backed ones are not. */
  readonly deterministic: boolean;

  /**
   * Applying the transform to its own output reproduces that output. See the module note — two
   * built-ins are deliberately `false` here despite looking harmless.
   */
  readonly idempotent: boolean;

  /**
   * The original value is recoverable from the output, in principle, even when no inverse transform
   * is registered. `lowercase` is not — case information is discarded, not merely re-encoded.
   */
  readonly reversible: boolean;

  /**
   * Other transform names this one presumes already ran. Empty for every built-in, since mapping
   * applies at most one transform per field and never chains them — declared for registry-supplied
   * transforms that may legitimately require a prior normalization step.
   */
  readonly dependencies: readonly string[];

  /**
   * Whether evaluating the transform does anything beyond compute its return value. `false` for
   * every built-in — `TransformFn` is typed as a pure `Scalar → unknown`, and this field is the
   * declarative statement of that invariant, checkable without reading the function body.
   */
  readonly sideEffects: boolean;

  readonly description: string;
}

/**
 * Metadata for every built-in transform, keyed identically to `BUILT_IN_TRANSFORMS`.
 *
 * The `Readonly<Record<TransformName, …>>` annotation is load-bearing: it is what turns "someone
 * added a transform and forgot its metadata" into a compiler error instead of a gap an admin surface
 * discovers by rendering `undefined`.
 */
export const BUILT_IN_TRANSFORM_METADATA: Readonly<Record<TransformName, TransformMetadata>> = {
  identity: {
    name: "identity",
    category: "structural",
    cost: "trivial",
    deterministic: true,
    idempotent: true,
    reversible: true,
    dependencies: [],
    sideEffects: false,
    description: "Passes the value through unchanged.",
  },
  lowercase: {
    name: "lowercase",
    category: "normalization",
    cost: "trivial",
    deterministic: true,
    idempotent: true,
    reversible: false,
    dependencies: [],
    sideEffects: false,
    description: "Folds a string to lowercase. Case information is discarded, not encoded.",
  },
  uppercase: {
    name: "uppercase",
    category: "normalization",
    cost: "trivial",
    deterministic: true,
    idempotent: true,
    reversible: false,
    dependencies: [],
    sideEffects: false,
    description: "Folds a string to uppercase. Case information is discarded, not encoded.",
  },
  trim: {
    name: "trim",
    category: "normalization",
    cost: "trivial",
    deterministic: true,
    idempotent: true,
    reversible: false,
    dependencies: [],
    sideEffects: false,
    description: "Removes leading/trailing whitespace. The removed whitespace is not recoverable.",
  },
  minor_to_major: {
    name: "minor_to_major",
    category: "unit_conversion",
    cost: "trivial",
    deterministic: true,
    // NOT idempotent — see the module note. A second application divides an already-major value by
    // 100 again, which under-reports the amount by two orders of magnitude with no error anywhere.
    idempotent: false,
    // Reversible in the mathematical sense (multiply by 100 recovers the input exactly for values
    // free of floating-point rounding), even though no inverse transform is registered.
    reversible: true,
    dependencies: [],
    sideEffects: false,
    description: "Divides integer minor units (cents) by 100 into the major-unit decimal.",
  },
  to_string: {
    name: "to_string",
    category: "type_coercion",
    cost: "trivial",
    deterministic: true,
    idempotent: true,
    // Lossy for values whose string form is not canonical — "007" stringified from 7 loses the
    // leading zeros a naive round trip would expect back.
    reversible: false,
    dependencies: [],
    sideEffects: false,
    description: "Coerces the value to its string representation via `String()`.",
  },
  to_number: {
    name: "to_number",
    category: "type_coercion",
    cost: "trivial",
    deterministic: true,
    idempotent: true,
    // Lossy in general: a non-numeric string becomes NaN with no way back, and numeric formatting
    // ("5.0", "0x5") is not preserved.
    reversible: false,
    dependencies: [],
    sideEffects: false,
    description: "Coerces a numeric string to a number via `Number()`; non-strings pass through.",
  },
  to_unix_seconds: {
    name: "to_unix_seconds",
    category: "unit_conversion",
    cost: "trivial",
    deterministic: true,
    // NOT idempotent — see the module note. Reapplied to its own output (seconds), the numeric
    // branch reinterprets it as milliseconds and collapses the timestamp to near the epoch.
    idempotent: false,
    reversible: false,
    dependencies: [],
    sideEffects: false,
    description: "Converts an epoch-ms number or ISO-8601 string to whole epoch seconds.",
  },
  to_array: {
    name: "to_array",
    category: "structural",
    cost: "trivial",
    deterministic: true,
    // The produced array is not itself a `Scalar`, so re-applying the transform to its own output is
    // not a well-formed operation under `TransformFn`'s signature — treated as false rather than
    // vacuously true.
    idempotent: false,
    reversible: true,
    dependencies: [],
    sideEffects: false,
    description: "Wraps a non-null value in a single-element array; null becomes an empty array.",
  },
};

/** Registry port for metadata of transforms the registry supplies beyond the built-in table. */
export interface TransformMetadataRegistryPort {
  resolve(name: string): TransformMetadata | null;
}

/**
 * Resolves metadata for a transform by name.
 *
 * Same fallback order as `applyMapping`'s own transform resolution — registry first, built-in
 * second — so a query about "the transform this mapping will actually run" cannot disagree with what
 * mapping itself resolves.
 */
export function metadataFor(
  name: string,
  registry?: TransformMetadataRegistryPort,
): TransformMetadata | null {
  return registry?.resolve(name) ?? BUILT_IN_TRANSFORM_METADATA[name as TransformName] ?? null;
}

/**
 * Whether applying the transform more than once in sequence is safe.
 *
 * A pure query over the declared facts — `deterministic` alone is not enough, since a deterministic
 * transform can still be non-idempotent (both built-ins above are). Used by whatever eventually
 * warns on a mapping profile that chains a transform onto its own output.
 */
export function isSafeToRepeat(metadata: TransformMetadata): boolean {
  return metadata.deterministic && metadata.idempotent;
}
