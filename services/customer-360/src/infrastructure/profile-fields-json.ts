import type { Prisma } from "@platform/db";
import type { ProfileField } from "../domain/profile-field";

/**
 * `ReadonlyMap<string, ProfileField>` ↔ plain-object JSON, shared by both Prisma adapters. A `Map`
 * cannot be stored in a `Json` column directly (JSON has no map type); a plain object round-trips
 * losslessly because field names are always plain strings, never numeric-looking in a way that would
 * confuse key ordering. Cast to `Prisma.InputJsonValue` at the boundary — same pattern
 * `services/security/src/infrastructure/prisma-mappers.ts` already established (a named interface
 * with a `value: unknown` member has no index signature, so it does not structurally satisfy
 * `InputJsonValue` even though every value it can hold is JSON-safe).
 */
/** Single assertion from `unknown` — same shape as `services/security/src/infrastructure/
 * prisma-mappers.ts`'s `json()` helper, not a double-cast, since the input to this function is
 * exactly the "structurally JSON-safe but not nominally `InputJsonValue`" case that helper exists for. */
function asInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export function fieldsToJson(fields: ReadonlyMap<string, ProfileField>): Prisma.InputJsonValue {
  return asInputJson(Object.fromEntries(fields));
}

export function jsonToFields(json: unknown): Map<string, ProfileField> {
  if (json === null || typeof json !== "object") return new Map();
  return new Map(Object.entries(json as Record<string, ProfileField>));
}
