import { createHash } from "node:crypto";
import { UniqueEntityId } from "./unique-entity-id";

/**
 * A deterministic, RFC-4122-shaped identifier (version nibble 5, variant 10) derived from the
 * first 16 bytes of SHA-256(`seed`). For child entities whose identity is a pure function of
 * their parent and position (e.g. an aggregate's append-only attempt log), so a re-save produces
 * the same id and `skipDuplicates` still dedupes, while the value fits a Postgres `UUID` column.
 * Not a random id: new aggregate ids still come from the `IdGenerator` port.
 */
export function deterministicEntityId(seed: string): UniqueEntityId {
  const bytes = createHash("sha256").update(seed).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return UniqueEntityId.from(
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`,
  );
}
