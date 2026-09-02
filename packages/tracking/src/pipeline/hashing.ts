/**
 * PII hashing stage (directive §PII Hashing; doc 09 §5).
 *
 * Ordering is an invariant, not a preference: hashing runs **after** normalize → validate →
 * identity stitching → consent, and never before. Two failure modes this prevents:
 *
 * 1. **Hashing before normalization** destroys every match. `SHA-256("  Ali@Example.COM ")` and
 *    `SHA-256("ali@example.com")` share no bits, yet both look like valid hashes on the wire, so
 *    the failure is invisible until match quality is inspected.
 * 2. **Hashing before stitching** makes identity resolution impossible — the graph needs the raw
 *    identifier to link a person across devices.
 *
 * Double-hashing is refused rather than tolerated: `hashStatus` is checked first, so a block that
 * has already been hashed passes through untouched instead of becoming an unmatched digest.
 */

import type { HashStatus, IdentityContext } from "../envelope/identity-context";
import { ADVANCED_MATCHING_FIELDS } from "../envelope/identity-context";
import type { HashPort } from "../ids/dedup-id";

/**
 * Fields hashed before leaving our boundary. `externalId` is deliberately **excluded**: platforms
 * expect it as an opaque, unhashed merchant identifier, and hashing it breaks matching.
 */
export const HASHED_FIELDS: readonly (keyof IdentityContext)[] = ADVANCED_MATCHING_FIELDS.filter(
  (field) => field !== "externalId",
);

export class DoubleHashError extends Error {
  constructor(readonly status: HashStatus) {
    super(`identity block is already hashed (status: ${status}); refusing to hash again`);
    this.name = "DoubleHashError";
  }
}

/**
 * Hashes the matchable fields of an already-normalized identity block.
 *
 * Requires `hashStatus === "raw"`. An unset status is treated as an error rather than assumed raw:
 * guessing wrong silently double-hashes every conversion, which degrades match quality without
 * producing a single error.
 */
export async function hashIdentity(
  identity: IdentityContext,
  hasher: HashPort,
): Promise<IdentityContext> {
  if (identity.hashStatus !== "raw") {
    throw new DoubleHashError(identity.hashStatus ?? "mixed");
  }

  const hashed: Record<string, unknown> = { ...identity };

  for (const field of HASHED_FIELDS) {
    const value = identity[field];
    if (typeof value !== "string" || value.trim() === "") continue;
    hashed[field] = await hasher.sha256Hex(value);
  }

  hashed.hashStatus = "sha256";
  return hashed;
}

/** True when the block is safe to forward to an external destination. */
export function isForwardable(identity: IdentityContext): boolean {
  return identity.hashStatus === "sha256";
}

/**
 * The canonical pipeline order (directive §Pipeline order). Exported as data so the stage sequence
 * is asserted by tests rather than maintained only in prose — a reordering that breaks the hashing
 * invariant then fails a test instead of shipping.
 */
export const PIPELINE_STAGES = [
  "capture",
  "normalize",
  "validate",
  "enrichment",
  "identity_stitching",
  "consent_resolution",
  "attribution",
  "pii_hashing",
  "platform_mapping",
  "destination_formatting",
  // `destination_routing` and `retry` were named by REPLAY_STAGES from the start but were missing
  // here, so the two vocabularies disagreed: the record could not express the very stages replay
  // is permitted to run. Added (M6) so stage history can record what the runtime actually does.
  "destination_routing",
  "delivery",
  "retry",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** Position of a stage, for ordering assertions. */
export function stageIndex(stage: PipelineStage): number {
  return PIPELINE_STAGES.indexOf(stage);
}

/** True when `before` genuinely precedes `after` in the canonical order. */
export function stagePrecedes(before: PipelineStage, after: PipelineStage): boolean {
  return stageIndex(before) < stageIndex(after);
}
