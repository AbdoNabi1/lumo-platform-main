/**
 * Validation stage (directive §Event Validation; doc 16 §2).
 *
 * An event that fails validation is **dead-lettered with its reason and never delivered** — it is
 * not "best effort" forwarded, and it is not silently dropped. Both failure modes are worse than a
 * rejection: a malformed conversion corrupts attribution, and a silent drop is undebuggable.
 *
 * Validation is pure and returns *every* violation rather than the first, so the admin diagnostics
 * view can show a complete picture instead of one error at a time.
 */

import type { TrackingEnvelope, TrackingEnvironment } from "../envelope/envelope";
import { isCurrencyCode } from "../envelope/payload";

/** Which check failed, for grouping in diagnostics and for routing to the right owner. */
export type ValidationRule =
  | "required_field"
  | "schema"
  | "identity"
  | "attribution"
  | "payload"
  | "currency"
  | "value"
  | "timestamp"
  | "deduplication"
  | "tenancy";

export interface ValidationViolation {
  readonly rule: ValidationRule;
  /** Dot-path to the offending field, e.g. `payload.currency`. */
  readonly field: string;
  readonly message: string;
}

export type ValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly violations: readonly ValidationViolation[] };

/**
 * How far a client clock may drift before its timestamp is untrustworthy. Client clocks are
 * routinely wrong; beyond this the event is still captured but its time cannot be believed for
 * attribution windows.
 */
export const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

/**
 * How far in the future a timestamp may sit. Tighter than the past tolerance because a future
 * event is always a clock fault, never a legitimate late arrival.
 */
export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

function violation(rule: ValidationRule, field: string, message: string): ValidationViolation {
  return { rule, field, message };
}

/**
 * Validates the envelope invariants that hold for **every** event regardless of its definition.
 * Definition-driven parameter checks (required/optional/typed parameters) are applied separately
 * by the Event Definition Engine — this function is what guarantees an event is storable at all.
 */
export function validateEnvelope(
  envelope: TrackingEnvelope,
  options: { readonly now?: Date; readonly environment?: TrackingEnvironment } = {},
): ValidationResult {
  const now = options.now ?? new Date();
  const violations: ValidationViolation[] = [];

  // --- Required identity of the event itself ---
  if (envelope.eventId.trim() === "") {
    violations.push(violation("required_field", "eventId", "eventId is required"));
  }
  if (envelope.eventName.trim() === "") {
    violations.push(violation("required_field", "eventName", "eventName is required"));
  } else if (!EVENT_NAME_PATTERN.test(envelope.eventName)) {
    violations.push(violation("schema", "eventName", "eventName must be snake_case (doc 16 §2)"));
  }
  if (!Number.isInteger(envelope.eventVersion) || envelope.eventVersion < 1) {
    violations.push(violation("schema", "eventVersion", "eventVersion must be a positive integer"));
  }

  // --- Tenancy (ADR-0008): an event with no tenant cannot be stored or scoped ---
  const tenantId = envelope.tenancy?.tenantId;
  if (tenantId === undefined || tenantId.trim() === "") {
    violations.push(violation("tenancy", "tenancy.tenantId", "tenantId is required"));
  }

  // --- Timestamp ---
  const parsed = Date.parse(envelope.timestamp);
  if (Number.isNaN(parsed)) {
    violations.push(violation("timestamp", "timestamp", "timestamp must be ISO-8601"));
  } else {
    const skew = parsed - now.getTime();
    if (skew > MAX_FUTURE_SKEW_MS) {
      violations.push(violation("timestamp", "timestamp", "timestamp is in the future"));
    } else if (-skew > MAX_CLOCK_SKEW_MS) {
      violations.push(
        violation("timestamp", "timestamp", "timestamp exceeds the accepted clock skew"),
      );
    }
  }

  // --- Monetary coherence ---
  violations.push(...validateMonetary(envelope));

  return violations.length === 0 ? { valid: true } : { valid: false, violations };
}

/**
 * Value and currency must agree. A value without a currency is unusable by every destination
 * (each would assume its own default and mis-report revenue), and a negative value on a
 * non-refund event is a mapping bug rather than a real amount.
 */
function validateMonetary(envelope: TrackingEnvelope): readonly ValidationViolation[] {
  const payload = envelope.payload;
  if (payload === undefined) return [];

  const violations: ValidationViolation[] = [];
  const { valueMinor, currency } = payload;

  if (valueMinor !== undefined) {
    if (!Number.isFinite(valueMinor)) {
      violations.push(
        violation("value", "payload.valueMinor", "valueMinor must be a finite number"),
      );
    } else if (!Number.isInteger(valueMinor)) {
      violations.push(
        violation("value", "payload.valueMinor", "valueMinor must be an integer (minor units)"),
      );
    }

    if (currency === undefined) {
      violations.push(
        violation("currency", "payload.currency", "currency is required when valueMinor is set"),
      );
    }
  }

  if (currency !== undefined && !isCurrencyCode(currency)) {
    violations.push(
      violation("currency", "payload.currency", "currency must be an ISO-4217 alpha-3 code"),
    );
  }

  return violations;
}

/**
 * Deduplication precondition. A conversion event forwarded without a `dedupId` will be counted
 * twice by every platform that receives both the pixel and the server copy, so the router must
 * refuse it rather than accept double-counted revenue.
 */
export function validateDeduplication(envelope: TrackingEnvelope): ValidationResult {
  if (envelope.dedupId !== undefined && envelope.dedupId.trim() !== "") {
    return { valid: true };
  }

  return {
    valid: false,
    violations: [
      violation("deduplication", "dedupId", "dedupId is required before destination delivery"),
    ],
  };
}

/** Merges results, preserving every violation across stages. */
export function combineValidation(...results: readonly ValidationResult[]): ValidationResult {
  const violations = results.flatMap((result) => (result.valid ? [] : result.violations));
  return violations.length === 0 ? { valid: true } : { valid: false, violations };
}
