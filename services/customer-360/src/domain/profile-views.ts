import type { CustomerProfile } from "./customer-profile";
import type { ProfileField, ProfileFieldConfidence } from "./profile-field";

/**
 * Read-side views over a {@link CustomerProfile} — merge, completeness, freshness, source
 * attribution, confidence. Phase 6.2 names these as distinct responsibilities but they are pure
 * derivations of data already on the profile, not independent state or I/O; modeling each as its own
 * use case/port would be exactly the "generic abstraction without a real current requirement" the
 * constitution's no-over-engineering rule forbids. They are computed here and surfaced together by
 * `GetCustomerProfile`.
 */

/**
 * Merges every cluster member's own profile into one unified view (the "360" in Customer 360) — the
 * Profile Merge View. Per field name, the entry with the highest field-level `version` wins (ties
 * broken by the later `updatedAt`); this is deliberately **not** delegated to `applyFieldUpdate`'s
 * freshness guard, because that guard compares *incoming vs. stored* during a write, while this
 * compares *stored vs. stored* across several already-persisted profiles during a read — same
 * "freshest fact wins" intent, different inputs.
 *
 * The merged view's own `version` is the max across inputs — it is a computed read, not a new ledger
 * entry, so it must never invent a version number no snapshot actually has.
 */
export function mergeProfiles(
  profiles: readonly CustomerProfile[],
  mergedIdentifierType: string,
  mergedIdentifierValue: string,
  now: string,
): CustomerProfile {
  const fields = new Map<string, ProfileField>();
  let maxVersion = 0;
  let latestUpdatedAt = "";

  for (const profile of profiles) {
    maxVersion = Math.max(maxVersion, profile.version);
    if (profile.updatedAt > latestUpdatedAt) latestUpdatedAt = profile.updatedAt;

    for (const [name, field] of profile.fields) {
      const current = fields.get(name);
      if (
        current === undefined ||
        field.version > current.version ||
        (field.version === current.version && field.updatedAt > current.updatedAt)
      ) {
        fields.set(name, field);
      }
    }
  }

  return {
    identifierType: mergedIdentifierType,
    identifierValue: mergedIdentifierValue,
    fields,
    version: maxVersion,
    updatedAt: latestUpdatedAt === "" ? now : latestUpdatedAt,
  };
}

/** Fraction of `expectedFields` present on the profile, in `[0, 1]`. An empty expectation is
 * vacuously complete (1) — there is nothing to be missing. */
export function profileCompleteness(
  profile: CustomerProfile,
  expectedFields: readonly string[],
): number {
  if (expectedFields.length === 0) return 1;
  const present = expectedFields.filter((field) => profile.fields.has(field)).length;
  return present / expectedFields.length;
}

/** Age (ms) of every field relative to `now` — the Profile Freshness view. */
export function profileFreshness(
  profile: CustomerProfile,
  now: string,
): ReadonlyMap<string, number> {
  const nowMs = Date.parse(now);
  const ages = new Map<string, number>();
  for (const [name, field] of profile.fields) {
    ages.set(name, Math.max(0, nowMs - Date.parse(field.updatedAt)));
  }
  return ages;
}

/** Field names whose age exceeds `thresholdMs` — the operational half of Freshness (what to flag). */
export function staleFields(
  profile: CustomerProfile,
  now: string,
  thresholdMs: number,
): readonly string[] {
  const ages = profileFreshness(profile, now);
  return [...ages.entries()].filter(([, age]) => age > thresholdMs).map(([name]) => name);
}

/** `field name -> source` — the Profile Source Attribution view. */
export function profileFieldSources(profile: CustomerProfile): ReadonlyMap<string, string> {
  const sources = new Map<string, string>();
  for (const [name, field] of profile.fields) sources.set(name, field.source);
  return sources;
}

export interface ProfileConfidenceSummary {
  readonly verified: number;
  readonly inferred: number;
  /** Weakest-link, not strongest-evidence: a profile is only as trustworthy as its least trustworthy
   * field, which is the opposite of Identity Engine's `resolveIdentity` (one deterministic edge
   * anchors the whole cluster). The two are different domain questions — "is this link real"
   * (corroborating evidence strengthens it) vs. "can this data be trusted" (one bad field taints the
   * merged read) — so sharing the "OR wins" rule here would be a semantics bug, not reuse. */
  readonly overall: ProfileFieldConfidence;
}

/** The Profile Confidence View. An empty profile is reported `inferred` — there is no verified
 * evidence, so "verified" would overstate what is actually known. */
export function profileConfidenceSummary(profile: CustomerProfile): ProfileConfidenceSummary {
  let verified = 0;
  let inferred = 0;
  for (const field of profile.fields.values()) {
    if (field.confidence === "verified") verified += 1;
    else inferred += 1;
  }
  const overall: ProfileFieldConfidence =
    profile.fields.size > 0 && inferred === 0 ? "verified" : "inferred";
  return { verified, inferred, overall };
}
