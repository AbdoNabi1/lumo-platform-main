import type { ProfileField } from "./profile-field";
import type { CustomerProfile } from "./customer-profile";

/** Why a snapshot was captured — the identity engine's own timeline entries use the same
 * "kind describes provenance" shape (`IdentityTimelineEntry`). */
export type ProfileSnapshotReason = "created" | "updated" | "rebuilt";

/**
 * An immutable, full capture of a {@link CustomerProfile}'s fields at one version — the durable,
 * append-only ledger entry (`ProfileHistoryStore`). Never edited or replaced; a later change is
 * always a new snapshot with a higher `version`. Full-profile (not diff-only) capture keeps rebuild
 * trivial — reconstructing the current view is just "read the latest snapshot" — at the accepted cost
 * of storing the whole field set on every update (same tradeoff `PrismaIdentityGraphStore` already
 * documents accepting for Identity Engine's O(n) replay: fine at Phase 6.2 scale, revisit if it
 * becomes a bottleneck).
 *
 * `identifierType`/`identifierValue` are plain strings — see `customer-profile.ts`'s module doc for
 * why `domain/` never references `@platform/tracking`'s `IdentifierType` or this package's own
 * `IdentifierRef` port type directly.
 */
export interface ProfileSnapshot {
  readonly identifierType: string;
  readonly identifierValue: string;
  readonly version: number;
  readonly fields: ReadonlyMap<string, ProfileField>;
  readonly capturedAt: string;
  readonly reason: ProfileSnapshotReason;
}

export function toSnapshot(
  profile: CustomerProfile,
  reason: ProfileSnapshotReason,
  capturedAt: string,
): ProfileSnapshot {
  return {
    identifierType: profile.identifierType,
    identifierValue: profile.identifierValue,
    version: profile.version,
    fields: profile.fields,
    capturedAt,
    reason,
  };
}

/** Reconstructs the current profile view from the latest snapshot — the whole of "rebuild": each
 * snapshot already carries the full field set, so recovery never needs to fold history. */
export function fromSnapshot(snapshot: ProfileSnapshot): CustomerProfile {
  return {
    identifierType: snapshot.identifierType,
    identifierValue: snapshot.identifierValue,
    fields: snapshot.fields,
    version: snapshot.version,
    updatedAt: snapshot.capturedAt,
  };
}
