import {
  createProfileField,
  type ProfileField,
  type ProfileFieldConfidence,
} from "./profile-field";
import { INITIAL_PROFILE_VERSION, type ProfileVersion } from "./profile-version";

/**
 * The materialized customer profile — a projection, not a source of truth (Phase 6.2 contract).
 * Keyed by `identifierType`/`identifierValue` as **plain strings**, not `@platform/tracking`'s
 * `IdentifierType` union or the package's own `IdentifierRef` port type — `domain/` may depend only
 * on the shared kernel (`domain-stays-pure`, dependency-cruiser), never on another bounded context's
 * package or on this package's own ports. This matches the established repo convention for a
 * cross-context reference inside a pure domain layer: Finance's `LedgerEntry.accountRef` is a plain
 * `string`, not a rich `AccountRef` type, for exactly the same reason. Ports and application code
 * (which may depend on `@platform/tracking`) convert to/from the real `IdentifierRef` at the
 * boundary — see `ports/identity-decision.ts`'s `IdentifierRef` and the call sites that narrow back
 * to it with `as IdentifierType`.
 *
 * A profile can exist before a stable `customer_id` does (e.g. a guest checkout profile keyed by
 * `visitor_id`); assembling the *unified* view across every identifier belonging to one person is
 * {@link mergeProfiles}'s job, not this type's — `CustomerProfile` is one identifier's own
 * accumulated fields.
 */
export interface CustomerProfile {
  readonly identifierType: string;
  readonly identifierValue: string;
  readonly fields: ReadonlyMap<string, ProfileField>;
  /** Bumped on every applied field change — the profile's own optimistic-read version, distinct from
   * (and always >= the max of) each field's own `version`. */
  readonly version: ProfileVersion;
  readonly updatedAt: string;
}

export function createEmptyProfile(
  identifierType: string,
  identifierValue: string,
  now: string,
): CustomerProfile {
  return {
    identifierType,
    identifierValue,
    fields: new Map(),
    version: INITIAL_PROFILE_VERSION,
    updatedAt: now,
  };
}

export interface FieldUpdateInput {
  readonly value: unknown;
  readonly source: string;
  readonly confidence: ProfileFieldConfidence;
  readonly occurredAt: string;
}

export interface FieldUpdateResult {
  readonly profile: CustomerProfile;
  /** `false` when the update was a no-op because a fresher value is already on file for this field
   * (see the module doc on out-of-order delivery) — the caller must not treat this as a write. */
  readonly applied: boolean;
}

/**
 * Applies one field update, append-only: never mutates `profile`, always returns a new value.
 *
 * **Freshness guard**: if the field already holds a value whose `updatedAt` is at or after the
 * incoming `occurredAt`, the update is rejected (`applied: false`, `profile` returned unchanged) —
 * events are delivered at-least-once and are not guaranteed ordered (doc 20 §1), so a late-arriving
 * stale fact must never silently overwrite a fresher one. This is the same class of "silent success
 * that isn't" risk the Phase 6.1 audit found in `SplitIdentity` — here it is designed out from the
 * start instead of patched in afterward.
 */
export function applyFieldUpdate(
  profile: CustomerProfile,
  field: string,
  update: FieldUpdateInput,
): FieldUpdateResult {
  const existing = profile.fields.get(field);
  if (existing !== undefined && existing.updatedAt >= update.occurredAt) {
    return { profile, applied: false };
  }

  const nextFieldVersion = existing === undefined ? 1 : existing.version + 1;
  const nextField = createProfileField(
    update.value,
    update.source,
    update.occurredAt,
    update.confidence,
    nextFieldVersion,
  );

  const fields = new Map(profile.fields);
  fields.set(field, nextField);

  return {
    applied: true,
    profile: {
      identifierType: profile.identifierType,
      identifierValue: profile.identifierValue,
      fields,
      version: profile.version + 1,
      updatedAt: update.occurredAt > profile.updatedAt ? update.occurredAt : profile.updatedAt,
    },
  };
}
