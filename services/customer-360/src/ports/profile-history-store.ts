import type { DomainEvent } from "@platform/domain";
import type { IdentifierRef } from "./identity-decision";
import type { ProfileSnapshot } from "../domain/profile-snapshot";

/**
 * Persistence port for the profile ledger — the durable source of truth `ProfileStore`'s cache is
 * rebuilt from. Append-only, same discipline as `IdentityGraphStore`/`IdentityDecisionStore`: a
 * snapshot is never updated or deleted, only appended.
 */
export interface ProfileHistoryStore {
  /** Persists one snapshot. `event` is written to the outbox in the same unit of work — mirrors
   * `IdentityDecisionStore.record`'s shape exactly (same package, same convention). */
  append(snapshot: ProfileSnapshot, event: DomainEvent, tx?: unknown): Promise<void>;
  /** Every snapshot for this identifier, oldest first — the profile's own history/provenance trail. */
  listFor(identifier: IdentifierRef, tx?: unknown): Promise<readonly ProfileSnapshot[]>;
  /** The most recent snapshot only — `RebuildProfileProjection` needs just this (each snapshot is a
   * full capture, so replay-from-latest is sufficient; see `profile-snapshot.ts`). `null` when the
   * identifier has no history yet. */
  latestFor(identifier: IdentifierRef, tx?: unknown): Promise<ProfileSnapshot | null>;
}
