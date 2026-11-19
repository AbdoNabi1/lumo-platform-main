import type { Result } from "@platform/types";
import type { DomainError } from "@platform/utils";

/** Test helper: the value of an ok result (throws a readable error otherwise). */
export function okValue<T>(r: Result<T, DomainError>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}: ${r.error.message}`);
  return r.value;
}

/** Test helper: the error of a failed result (throws a readable error otherwise). */
export function errorOf<T>(r: Result<T, DomainError>): DomainError {
  if (r.ok) throw new Error(`expected an error, got ok: ${JSON.stringify(r.value)}`);
  return r.error;
}
