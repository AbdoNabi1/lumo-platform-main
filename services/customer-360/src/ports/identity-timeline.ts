import type { IdentifierType, IdentityConfidence } from "@platform/tracking";

/** One chronological entry in an identifier's provenance history — an observed link, or an
 * explicit merge/split decision. Read-only projection; never persisted as its own row. */
export type IdentityTimelineEntry =
  | {
      readonly kind: "observed";
      readonly occurredAt: string;
      readonly counterpartType: IdentifierType;
      readonly counterpartValue: string;
      readonly confidence: IdentityConfidence;
      readonly source: string;
    }
  | {
      readonly kind: "merged" | "split";
      readonly occurredAt: string;
      readonly decisionId: string;
      readonly counterpartType: IdentifierType;
      readonly counterpartValue: string;
      readonly reason: string;
      readonly actor: string;
    };
