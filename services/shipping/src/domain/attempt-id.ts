import { deterministicEntityId } from "@platform/domain";

/**
 * Deterministic RFC-4122-shaped id (version 5, variant 10) from SHA-256 of
 * `${aggregateId}:attempt:${index}` (Ruling 7). `shipping_attempts.id` is a `UUID` column, so the
 * old `<uuid><index>` ids were refused; a deterministic id keeps `skipDuplicates` deduping re-saves.
 */
export function attemptIdFor(aggregateId: string, index: number): string {
  return deterministicEntityId(`${aggregateId}:attempt:${index}`).toString();
}
