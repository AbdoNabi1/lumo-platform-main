/**
 * Mapping engine (directive §Mapping Engine).
 *
 * There are **no hardcoded payload builders**. A destination's payload is produced by walking a
 * declarative `MappingProfile` — parameter mapping, rename, value transform, conditional mapping,
 * platform defaults, versioning — all of it configuration held in the Registry. Adding or
 * re-mapping a platform is a registry write, not a deployment.
 *
 * Conditional mapping reuses the Engine Kernel (`@platform/expression`, ADR-0053); this module does
 * not implement a second condition language.
 */

import {
  evaluate,
  evaluateOrFalse,
  type EvaluationContext,
  type Expression,
  type Scalar,
} from "@platform/expression";

/** Named, pure value transforms. Registered through the Registry — never inlined per platform. */
export type TransformName =
  | "identity"
  | "lowercase"
  | "uppercase"
  | "trim"
  | "minor_to_major"
  | "to_string"
  | "to_number"
  | "to_unix_seconds"
  | "to_array";

/**
 * A transform is a pure `Scalar → unknown`. Hashing is deliberately **absent**: PII hashing is its
 * own pipeline stage that runs before mapping, so a mapper cannot accidentally double-hash.
 */
export type TransformFn = (value: Scalar) => unknown;

export const BUILT_IN_TRANSFORMS: Readonly<Record<TransformName, TransformFn>> = {
  identity: (value) => value,
  lowercase: (value) => (typeof value === "string" ? value.toLowerCase() : value),
  uppercase: (value) => (typeof value === "string" ? value.toUpperCase() : value),
  trim: (value) => (typeof value === "string" ? value.trim() : value),
  // Minor units (integer cents) to the major-unit decimal every ad platform expects.
  minor_to_major: (value) => (typeof value === "number" ? value / 100 : value),
  to_string: (value) => (value === null ? null : String(value)),
  to_number: (value) => (typeof value === "string" ? Number(value) : value),
  to_unix_seconds: (value) => {
    if (typeof value === "number") return Math.floor(value / 1000);
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
    }
    return null;
  },
  to_array: (value) => (value === null ? [] : [value]),
};

/** Resolves a transform by name. Registry-supplied transforms override built-ins. */
export interface TransformRegistryPort {
  resolve(name: string): TransformFn | null;
}

/** One field's mapping rule. */
export interface FieldMapping {
  /** Dot-path in the produced payload, e.g. `user_data.em`. */
  readonly target: string;
  /** Dot-path in the source context. Omitted when the field is a constant. */
  readonly source?: string;
  /** Emitted when the source resolves to nothing. */
  readonly defaultValue?: Scalar;
  readonly transform?: string;
  /** Conditional mapping — the field is emitted only when this evaluates true. */
  readonly when?: Expression;
  /** A required field whose value is absent fails the mapping rather than sending a partial. */
  readonly required?: boolean;
}

export interface MappingProfile {
  readonly key: string;
  readonly version: number;
  readonly destination: string;
  /** Constants merged first; field mappings win over them. */
  readonly constants?: Readonly<Record<string, Scalar>>;
  readonly fields: readonly FieldMapping[];
}

export type MappingFailure =
  | { readonly code: "missing_required"; readonly target: string; readonly source?: string }
  | { readonly code: "unknown_transform"; readonly target: string; readonly transform: string }
  | { readonly code: "condition_error"; readonly target: string; readonly detail: string };

export type MappingOutcome =
  | { readonly ok: true; readonly payload: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly failures: readonly MappingFailure[] };

function readPath(context: EvaluationContext, path: string): unknown {
  let current: unknown = context;
  for (const segment of path.split(".")) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Writes a dot-path into a nested object, creating intermediate objects as needed. */
function writePath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".");
  let cursor = target;

  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    if (segment === undefined) return;
    const next = cursor[segment];
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }

  const last = segments[segments.length - 1];
  if (last !== undefined) cursor[last] = value;
}

function asScalar(value: unknown): Scalar | undefined {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return undefined;
}

/**
 * Applies a mapping profile to a context.
 *
 * Every failure is collected rather than thrown, so the admin surface can show a complete picture
 * of why a platform mapping is incomplete instead of one error per attempt. A profile with any
 * failure produces **no payload at all** — sending a partial conversion is worse than sending
 * none, because it looks successful while under-reporting.
 */
export function applyMapping(
  profile: MappingProfile,
  context: EvaluationContext,
  transforms?: TransformRegistryPort,
): MappingOutcome {
  const payload: Record<string, unknown> = {};
  const failures: MappingFailure[] = [];

  for (const [key, value] of Object.entries(profile.constants ?? {})) {
    writePath(payload, key, value);
  }

  for (const field of profile.fields) {
    if (field.when !== undefined) {
      const decision = evaluate(field.when, context);
      if (!decision.ok) {
        failures.push({
          code: "condition_error",
          target: field.target,
          detail: decision.error.code,
        });
        continue;
      }
      if (!decision.value) continue;
    }

    const raw = field.source === undefined ? undefined : readPath(context, field.source);
    const resolved = raw === undefined || raw === null ? field.defaultValue : raw;

    if (resolved === undefined || resolved === null) {
      if (field.required === true) {
        failures.push({
          code: "missing_required",
          target: field.target,
          ...(field.source === undefined ? {} : { source: field.source }),
        });
      }
      continue;
    }

    let value: unknown = resolved;

    if (field.transform !== undefined && field.transform !== "identity") {
      const fn =
        transforms?.resolve(field.transform) ??
        BUILT_IN_TRANSFORMS[field.transform as TransformName];

      if (fn === undefined) {
        failures.push({
          code: "unknown_transform",
          target: field.target,
          transform: field.transform,
        });
        continue;
      }

      const scalar = asScalar(value);
      value = scalar === undefined ? value : fn(scalar);
    }

    writePath(payload, field.target, value);
  }

  return failures.length === 0 ? { ok: true, payload } : { ok: false, failures };
}

/** One field that emitted its default because the source resolved to nothing. */
export interface MappingFallback {
  readonly target: string;
  readonly source?: string;
  readonly defaultValue: Scalar;
}

/**
 * Which fields fell back to their default value.
 *
 * Exists so the ExecutionTrace can record *"why did a fallback occur?"* as a fact rather than infer
 * it. The inference alternative — comparing the produced payload against each `defaultValue` — is
 * wrong whenever the real source value happens to equal the default, and it is wrong silently.
 *
 * Deliberately a separate pass over the same profile rather than an extra field on
 * {@link MappingOutcome}: the outcome type is consumed by the delivery pipeline and the inspector,
 * and widening it would change a published signature for a diagnostic only the trace needs. It
 * reuses `readPath`, so "did the source resolve?" is answered by the same code that answers it
 * during `applyMapping` — two readers would eventually disagree about a null in a nested object.
 */
export function mappingFallbacks(
  profile: MappingProfile,
  context: EvaluationContext,
): readonly MappingFallback[] {
  const fallbacks: MappingFallback[] = [];

  for (const field of profile.fields) {
    if (field.defaultValue === undefined) continue;
    if (field.when !== undefined && !evaluateOrFalse(field.when, context)) continue;

    const raw = field.source === undefined ? undefined : readPath(context, field.source);
    if (raw !== undefined && raw !== null) continue;

    fallbacks.push({
      target: field.target,
      ...(field.source === undefined ? {} : { source: field.source }),
      defaultValue: field.defaultValue,
    });
  }

  return fallbacks;
}

/** Registry port for mapping profiles. Tracking resolves; it never stores. */
export interface MappingRegistryPort {
  resolve(key: string): MappingProfile | null;
  resolveVersion(key: string, version: number): MappingProfile | null;
}
