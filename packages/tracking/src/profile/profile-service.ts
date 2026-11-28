/**
 * The profile service (Tracking P1-D4): the one step the ingest path runs BEFORE routing and delivery —
 * look the visitor up, fold in what this event shows, store it, and hand the event back completed.
 *
 * ## Identity resolution
 *
 * Keys are tried in a fixed order — **customer id → email hash → phone hash → visitor cookie** — and every profile
 * found is folded into one (`mergeProfiles`: oldest survives, newest value wins per field, newest click id wins
 * per platform). Two rules keep that safe:
 *
 * - a profile that already belongs to a DIFFERENT customer than the event names is not a candidate at all, and
 *   two profiles of different customers are never merged (a shared phone must not hand one customer's data to
 *   another's events);
 * - every lookup is tenant-scoped by construction (`TrackingProfileStore` takes the tenant first), so two shops'
 *   profiles can never meet.
 *
 * ## Never in the way of a delivery
 *
 * A profile is an improvement to an event, not a precondition for it. If the store is down, or two workers keep
 * colliding on one visitor, the event goes on exactly as it arrived — the failure is reported through
 * `onError` (counts and names only: no hash, no id) and never thrown.
 */

import type { EnrichedEnvelope } from "../envelope/envelope";
import type { HashPort } from "../ids/dedup-id";
import {
  enrichEnvelopeWithProfile,
  isObservable,
  observationFromEnvelope,
} from "./profile-envelope";
import { deriveProfileHashes, profileMatchKeys, type ProfileMatchKeys } from "./profile-identity";
import { applyObservation, createProfile, customersConflict, mergeProfiles } from "./profile-merge";
import type { TrackingProfileStore } from "./profile-store";
import type { ProfileLookupKeys, ProfileObservation, TrackingProfile } from "./tracking-profile";

/** What the ingest path gets back: the event, completed, and the match keys the profile can add per platform. */
export interface ProfileEnrichment {
  readonly envelope: EnrichedEnvelope;
  readonly matchKeys?: ProfileMatchKeys;
}

/** The seam `ingestTrackingEvent` calls. Implemented by {@link TrackingProfileService}. */
export interface ProfileEnricherPort {
  enrich(envelope: EnrichedEnvelope): Promise<ProfileEnrichment>;
}

export interface ProfileServiceDeps {
  readonly store: TrackingProfileStore;
  readonly hasher: HashPort;
  readonly clock: { now(): Date };
  readonly defaultCountryCode?: string;
  /** Failures the service swallowed so the event could proceed. Receives no event data. */
  readonly onError?: (error: unknown) => void;
}

/** A fingerprint only identifies a profile seen this recently (a phone's address and the cell it sits on drift). */
export const FINGERPRINT_MATCH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** How many times a write that lost a race with another worker is re-read and re-applied. */
const MAX_WRITE_ATTEMPTS = 4;

export interface ProfileResolution {
  /** The folded profile (the survivor's identity and version), or `null` when nothing matched. */
  readonly merged: TrackingProfile | null;
  /** Stored profiles folded into `merged`, each with the version it was read at. */
  readonly absorbed: readonly { readonly visitorId: string; readonly version: number }[];
}

/**
 * Looks every key up in the fixed order and folds what it finds. Exported for the resolver tests; the service
 * is the only production caller.
 */
export async function resolveProfile(
  store: TrackingProfileStore,
  tenantId: string,
  keys: ProfileLookupKeys,
  now?: Date,
): Promise<ProfileResolution> {
  const candidates: TrackingProfile[] = [];
  const consider = (found: TrackingProfile | null): void => {
    if (found === null) return;
    if (candidates.some((candidate) => candidate.visitorId === found.visitorId)) return;
    // A profile that belongs to another customer than this event names is not this visitor's.
    if (
      keys.customerId !== undefined &&
      found.customerId !== undefined &&
      found.customerId !== keys.customerId
    ) {
      return;
    }
    candidates.push(found);
  };

  if (keys.customerId !== undefined)
    consider(await store.findByCustomerId(tenantId, keys.customerId));
  if (keys.emailStd !== undefined) consider(await store.findByEmailHash(tenantId, keys.emailStd));
  if (keys.phoneE164 !== undefined) consider(await store.findByPhoneHash(tenantId, keys.phoneE164));
  if (keys.visitorId !== undefined) consider(await store.findByVisitorId(tenantId, keys.visitorId));

  // The cookieless id is the LAST resort (owner Q6): only for an event with no visitor cookie at all (a lead or an
  // order saved server-side), only when nothing above identified the visitor, and only when it points at exactly
  // one recently seen profile. Several devices share one fingerprint (same carrier cell, same phone model), so an
  // ambiguous match is no match — and it never overrides a cookie or a customer.
  if (
    candidates.length === 0 &&
    keys.visitorId === undefined &&
    keys.fingerprintId !== undefined &&
    now !== undefined
  ) {
    const notBefore = new Date(now.getTime() - FINGERPRINT_MATCH_WINDOW_MS);
    const matches = await store.findByFingerprintId(tenantId, keys.fingerprintId, notBefore);
    if (matches.length === 1) consider(matches[0] ?? null);
  }

  let merged: TrackingProfile | null = null;
  const members: TrackingProfile[] = [];
  for (const candidate of candidates) {
    if (merged === null) {
      merged = candidate;
      members.push(candidate);
    } else if (!customersConflict(merged, candidate)) {
      merged = mergeProfiles(merged, candidate);
      members.push(candidate);
    }
  }

  const survivor = merged?.visitorId;
  return {
    merged,
    absorbed: members
      .filter((member) => member.visitorId !== survivor)
      .map((member) => ({ visitorId: member.visitorId, version: member.version })),
  };
}

export class TrackingProfileService implements ProfileEnricherPort {
  constructor(private readonly deps: ProfileServiceDeps) {}

  async enrich(envelope: EnrichedEnvelope): Promise<ProfileEnrichment> {
    try {
      const hashes = await deriveProfileHashes(
        envelope.context.identity,
        this.deps.hasher,
        this.deps.defaultCountryCode,
      );
      const observation = observationFromEnvelope(envelope, hashes);
      if (!isObservable(observation)) return { envelope };

      const profile = await this.observe(observation);
      return {
        envelope: enrichEnvelopeWithProfile(envelope, profile),
        matchKeys: profileMatchKeys(profile.hashes),
      };
    } catch (error) {
      this.deps.onError?.(error);
      return { envelope };
    }
  }

  /** Reads, folds, applies and stores — retrying a lost race — and returns the profile as it now stands. */
  private async observe(observation: ProfileObservation): Promise<TrackingProfile> {
    const now = this.deps.clock.now().toISOString();
    const keys: ProfileLookupKeys = {
      ...(observation.customerId === undefined ? {} : { customerId: observation.customerId }),
      ...(observation.hashes.emailStd === undefined
        ? {}
        : { emailStd: observation.hashes.emailStd }),
      ...(observation.hashes.phoneE164 === undefined
        ? {}
        : { phoneE164: observation.hashes.phoneE164 }),
      ...(observation.visitorId === undefined ? {} : { visitorId: observation.visitorId }),
      ...(observation.fingerprintId === undefined
        ? {}
        : { fingerprintId: observation.fingerprintId }),
    };

    let latest: TrackingProfile | undefined;
    for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
      const resolution = await resolveProfile(
        this.deps.store,
        observation.tenantId,
        keys,
        new Date(observation.at),
      );
      const base =
        resolution.merged ??
        createProfile({
          tenantId: observation.tenantId,
          visitorId: observation.visitorId ?? (await this.serverVisitorId(observation)),
          at: observation.at,
          now,
        });
      const updated = applyObservation(base, observation, now);

      const aliases = new Set(resolution.absorbed.map((absorbed) => absorbed.visitorId));
      if (observation.visitorId !== undefined && observation.visitorId !== updated.visitorId) {
        aliases.add(observation.visitorId);
      }

      const stored = await this.deps.store.persist({
        profile: updated,
        aliases: [...aliases],
        absorbed: resolution.absorbed,
      });
      latest = { ...updated, version: updated.version + (stored ? 1 : 0) };
      if (stored) return latest;
    }

    // Lost the race every time: the event still gets the profile as this worker saw it; nothing is stored.
    this.deps.onError?.(
      new Error("tracking profile write kept conflicting; event proceeded unpersisted"),
    );
    return latest as TrackingProfile;
  }

  /**
   * The cookie id of a profile created by a server event that has no cookie (a lead saved from a form, an order):
   * derived from the strongest identifier it carries, so two such events for one person land on one row.
   */
  private async serverVisitorId(observation: ProfileObservation): Promise<string> {
    const strongest =
      observation.customerId ??
      observation.hashes.phoneE164 ??
      observation.hashes.emailStd ??
      "anonymous";
    const digest = await this.deps.hasher.sha256Hex(`${observation.tenantId}|${strongest}`);
    return `srv_${digest.slice(0, 32)}`;
  }
}
