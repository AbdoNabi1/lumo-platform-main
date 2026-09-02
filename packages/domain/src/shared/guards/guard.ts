import { err, ok, type Result } from "@platform/types";
import { ValidationError, type FieldIssue } from "@platform/utils";

function fail(field: string, message: string): Result<never, ValidationError> {
  return err(new ValidationError(`${field} ${message}`, [{ field, message }]));
}

/**
 * Reusable validation helpers. Each returns a `Result` carrying a kernel `ValidationError`
 * on failure (no exceptions for expected validation; no external libraries).
 */
export const Guard = {
  againstNull<T>(value: T | null, field: string): Result<T, ValidationError> {
    return value === null ? fail(field, "must not be null") : ok(value);
  },

  againstUndefined<T>(value: T | undefined, field: string): Result<T, ValidationError> {
    return value === undefined ? fail(field, "must not be undefined") : ok(value);
  },

  againstNullOrUndefined<T>(
    value: T | null | undefined,
    field: string,
  ): Result<T, ValidationError> {
    return value === null || value === undefined ? fail(field, "is required") : ok(value);
  },

  againstEmpty<T extends string | readonly unknown[]>(
    value: T,
    field: string,
  ): Result<T, ValidationError> {
    const empty = typeof value === "string" ? value.trim().length === 0 : value.length === 0;
    return empty ? fail(field, "must not be empty") : ok(value);
  },

  againstNegative(value: number, field: string): Result<number, ValidationError> {
    return value < 0 ? fail(field, "must not be negative") : ok(value);
  },

  againstOutOfRange(
    value: number,
    min: number,
    max: number,
    field: string,
  ): Result<number, ValidationError> {
    return value < min || value > max
      ? fail(field, `must be between ${min} and ${max}`)
      : ok(value);
  },

  /** Aggregates several guard results; fails with all collected field issues. */
  combine(
    results: readonly Result<unknown, ValidationError>[],
    message = "Validation failed",
  ): Result<void, ValidationError> {
    const issues: FieldIssue[] = [];
    for (const result of results) {
      if (!result.ok) {
        issues.push(...result.error.fields);
      }
    }
    return issues.length === 0 ? ok(undefined) : err(new ValidationError(message, issues));
  },
} as const;
