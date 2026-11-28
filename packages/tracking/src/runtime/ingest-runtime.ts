/**
 * Ingest runtime (M6.6.1) — the **one** path from a captured event to the recording pipeline.
 *
 * M6 built `receiveAndDeliver` and left it unreachable: nothing in the platform called it, so the
 * engine was architecturally complete and operationally inert. The missing piece was never a second
 * pipeline — it was the small amount of work that has to happen *between* receiving an envelope off
 * a transport and handing it to the runtime: validate it, resolve the routing rule set, route it.
 *
 * That work lives here rather than in each entry point on purpose. If the Kafka consumer, an HTTP
 * route and a queue worker each did their own validation and routing, they would be three
 * execution paths that drift, and the guarantee "every production event flows through the same
 * pipeline" would be a claim rather than a fact. Entry points are transport only: decode bytes,
 * call {@link ingestTrackingEvent}, translate the outcome into an ack, a retry or a dead letter.
 *
 * ## What this module refuses to do
 *
 * It **never invents a value it cannot derive**. Three cases are worth naming, because the
 * convenient default in each is actively harmful:
 *
 * - **`dedupId`** is the key both the browser and server copies of one occurrence must agree on.
 *   Generating a fresh one when it is absent would guarantee the vendor counts the conversion
 *   twice — the exact failure deduplication exists to prevent. Absent and underivable ⇒ refused.
 * - **`environment`** decides whether an event may reach a live vendor. Defaulting to `production`
 *   forwards development traffic to real ad platforms; defaulting to `development` silently drops
 *   real revenue. Neither is recoverable after the fact, so an unlabelled event is refused.
 * - **`tenantId`** is never defaulted from configuration. A default tenant would file one merchant's
 *   conversions under another's, and the record would look perfectly well-formed.
 *
 * ## What it deliberately does *not* refuse
 *
 * A routing decision that excludes every destination, and a routing decision marked `degraded`, both
 * proceed into `receiveAndDeliver`. That is not leniency: the record is what makes the outcome
 * visible and replayable, and refusing at the door would leave no record that the event ever
 * arrived. An event that reached nobody is exactly the event an operator needs to find later.
 */

import type { DestinationRegistryPort } from "../delivery/destination";
import { route, type RoutingDecision, type RuleSetRegistryPort } from "../delivery/router";
import {
  applyConsentPolicy,
  DEFAULT_CONSENT_POLICY,
  type ConsentPolicy,
} from "../envelope/consent";
import type { EnrichedEnvelope, TrackingEnvelope } from "../envelope/envelope";
import { deriveDedupId, type HashPort, type NaturalKeyStrategy } from "../ids/dedup-id";
import type { AttributionSnapshot } from "../pipeline/attribution";
import type { ProfileEnricherPort } from "../profile/profile-service";
import type { ProfileMatchKeys } from "../profile/profile-identity";
import {
  combineValidation,
  validateDeduplication,
  validateEnvelope,
  type ValidationViolation,
} from "../pipeline/validation";
import type { ConsentPolicyPort } from "../settings/store-settings";
import {
  receiveAndDeliver,
  type RecordingRuntimeDeps,
  type ReceiveEventOutput,
} from "./delivery-runtime";

/**
 * Why an event was not admitted to the pipeline.
 *
 * Every refusal is explicit and carries its cause. None of them is a silent drop: an entry point
 * must dead-letter a refused event, which is what makes "we rejected 4,000 events yesterday"
 * answerable rather than invisible.
 */
export type IngestRefusal =
  | { readonly code: "validation_failed"; readonly violations: readonly ValidationViolation[] }
  | { readonly code: "environment_unknown" }
  | { readonly code: "non_production_event"; readonly environment: string }
  | { readonly code: "dedup_key_unavailable" }
  | { readonly code: "rule_set_unavailable"; readonly ruleSetKey: string };

/**
 * Refusals that will never resolve by trying again.
 *
 * A malformed envelope is malformed forever, so retrying it five times before dead-lettering only
 * delays the moment a human sees it and burns consumer throughput in between. `rule_set_unavailable`
 * is deliberately absent: a registry that has not finished loading, or is briefly unreachable, is a
 * transient condition and the event is perfectly valid — dead-lettering it would turn a momentary
 * outage into permanent conversion loss.
 */
export const PERMANENT_INGEST_REFUSALS: readonly IngestRefusal["code"][] = [
  "validation_failed",
  "environment_unknown",
  "non_production_event",
  "dedup_key_unavailable",
];

export function isPermanentRefusal(refusal: IngestRefusal): boolean {
  return PERMANENT_INGEST_REFUSALS.includes(refusal.code);
}

export type IngestOutcome =
  | {
      readonly status: "accepted";
      readonly delivery: ReceiveEventOutput;
      readonly routing: RoutingDecision;
    }
  /**
   * Tracking P2-D2: the store has nothing to send to (no active destination — a store that never connected an ad
   * platform — or, defensively, no routing rule set). The visitor profile was updated as for any event; NO event
   * record was appended and nothing was delivered, so a store with no connections adds nothing to the database. This
   * is a success, never a refusal: nothing is retried and nothing reaches the dead letters.
   */
  | { readonly status: "unrouted"; readonly reason: UnroutedReason }
  | { readonly status: "refused"; readonly refusal: IngestRefusal };

/** `no_destinations`: no active destination. `no_rule_set`: destinations exist but the configured rule set does not. */
export type UnroutedReason = "no_destinations" | "no_rule_set";

export interface IngestRuntimeDeps {
  /** Everything `receiveAndDeliver` needs. Passed through untouched — this module adds no stage. */
  readonly recording: RecordingRuntimeDeps;
  readonly destinations: DestinationRegistryPort;
  readonly ruleSets: RuleSetRegistryPort;
  /** Registry key of the routing rule set in force. Configuration, never hardcoded per vendor. */
  readonly ruleSetKey: string;
  readonly hasher: HashPort;
  readonly clock: { now(): Date };
  /**
   * Tracking P1-D4: the visitor profile. When present, every event is merged with it BEFORE routing — a server
   * event that carries no click id, browser id, IP or match key of its own leaves with the ones the same
   * visitor's earlier events left behind (click-id windows applied). Absent ⇒ events are forwarded as they
   * arrived. A profile failure never stops an event: the enricher returns the event unchanged.
   */
  readonly profiles?: ProfileEnricherPort;
  /**
   * Tracking P2-D1: the store's consent policy. When present, the consent an event is forwarded under is STAMPED here,
   * right after completion and before the profile merge, from the store's policy (`notice_only` ⇒ granted under the
   * notice; `opt_in` ⇒ as it arrived, fail-closed) — whatever the browser claimed. Absent ⇒ consent is left as it
   * arrived. A policy that cannot be read is `notice_only` (fail open), never a refusal.
   */
  readonly consentPolicy?: ConsentPolicyPort;
}

export interface IngestInput {
  readonly envelope: TrackingEnvelope;
  /** Attribution computed upstream, when the caller has it. Never recomputed here. */
  readonly attribution?: AttributionSnapshot;
  readonly identityConfidence?: number;
}

/**
 * Chooses the natural key two independent emitters would both arrive at.
 *
 * An order id is authoritative and stable, so it is preferred. A session plus a minute bucket is
 * the fallback for events with no natural key: it is coarse, but both emitters of one page view
 * will agree on it, which is the only property that matters. Anything weaker (a random id, the
 * event id, a millisecond timestamp) would differ between emitters and defeat deduplication while
 * appearing to work.
 */
function naturalKeyFor(envelope: TrackingEnvelope): NaturalKeyStrategy | null {
  const orderId = envelope.payload?.orderId;
  if (orderId !== undefined && orderId.trim() !== "") return { kind: "order", orderId };

  const sessionId = envelope.context.session?.sessionId;
  if (sessionId !== undefined && sessionId.trim() !== "") {
    return { kind: "session_minute", sessionId };
  }

  return null;
}

/**
 * Fills the fields `EnrichedEnvelope` guarantees, from values the envelope already carries.
 *
 * This is completion, not enrichment: nothing is looked up, inferred or defaulted from
 * configuration. `receivedAt` is the one value minted here, because "when the server received it"
 * is a fact only the server can state, and it is what bounds client clock skew.
 */
async function enrich(
  envelope: TrackingEnvelope,
  deps: Pick<IngestRuntimeDeps, "hasher" | "clock">,
): Promise<EnrichedEnvelope | { readonly refusal: IngestRefusal }> {
  const environment = envelope.environment;
  if (environment === undefined) return { refusal: { code: "environment_unknown" } };
  if (environment !== "production") {
    return { refusal: { code: "non_production_event", environment } };
  }

  // Validated immediately above by `validateEnvelope`; re-read here to satisfy the type rather than
  // asserted, so a future validation change cannot silently produce an untenanted enriched envelope.
  const tenantId = envelope.tenancy?.tenantId;
  if (tenantId === undefined || tenantId.trim() === "") {
    return {
      refusal: {
        code: "validation_failed",
        violations: [
          { rule: "tenancy", field: "tenancy.tenantId", message: "tenantId is required" },
        ],
      },
    };
  }

  const occurredAt = new Date(envelope.timestamp);
  let dedupId = envelope.dedupId;

  if (dedupId === undefined || dedupId.trim() === "") {
    const strategy = naturalKeyFor(envelope);
    if (strategy === null) return { refusal: { code: "dedup_key_unavailable" } };
    dedupId = await deriveDedupId(
      {
        tenantId,
        eventName: envelope.eventName,
        eventVersion: envelope.eventVersion,
        strategy,
        occurredAt,
      },
      deps.hasher,
    );
  }

  return {
    ...envelope,
    dedupId,
    eventTimestampMs: envelope.eventTimestampMs ?? occurredAt.getTime(),
    receivedAt: envelope.receivedAt ?? deps.clock.now().toISOString(),
    environment,
    tenancy: { ...envelope.tenancy, tenantId },
  };
}

/** Reads the policy; an unreadable one is the default (fail open — see `TrackingSettingsService`). */
async function consentPolicyOf(port: ConsentPolicyPort, tenantId: string): Promise<ConsentPolicy> {
  try {
    return await port.consentPolicyFor(tenantId);
  } catch {
    return DEFAULT_CONSENT_POLICY;
  }
}

/**
 * Validates → completes → routes → records → delivers.
 *
 * The only call to `receiveAndDeliver` in the platform is the one at the bottom of this function.
 * Every entry point reaches a vendor through here, so the ordering guarantees `receiveAndDeliver`
 * enforces — record appended before the first vendor call, above all — hold for all production
 * traffic rather than for one transport.
 */
export async function ingestTrackingEvent(
  deps: IngestRuntimeDeps,
  input: IngestInput,
): Promise<IngestOutcome> {
  const now = deps.clock.now();

  const validation = validateEnvelope(input.envelope, { now });
  if (!validation.valid) {
    return {
      status: "refused",
      refusal: { code: "validation_failed", violations: validation.violations },
    };
  }

  const enrichedEnvelope = await enrich(input.envelope, deps);
  if ("refusal" in enrichedEnvelope)
    return { status: "refused", refusal: enrichedEnvelope.refusal };

  // The ONE place consent is decided (P2-D1). The router, the delivery pipeline and replay keep their fail-closed
  // gates untouched: they judge the snapshot stamped here.
  const completed: EnrichedEnvelope =
    deps.consentPolicy === undefined
      ? enrichedEnvelope
      : {
          ...enrichedEnvelope,
          consent: applyConsentPolicy(
            enrichedEnvelope.consent,
            await consentPolicyOf(deps.consentPolicy, enrichedEnvelope.tenancy.tenantId),
            now,
          ),
        };

  // Merge-then-enrich BEFORE routing and delivery: the routing context, the recorded envelope and the vendor
  // payloads are all built from the completed event, so a later server event is indistinguishable, to every
  // later stage, from one that arrived with its identity attached.
  let enriched: EnrichedEnvelope = completed;
  let profileKeys: ProfileMatchKeys | undefined;
  if (deps.profiles !== undefined) {
    try {
      const withProfile = await deps.profiles.enrich(completed);
      enriched = withProfile.envelope;
      profileKeys = withProfile.matchKeys;
    } catch {
      // A profile is an improvement, never a precondition: deliver the event as it arrived.
    }
  }

  // Re-checked after completion: `validateEnvelope` cannot assert a dedup id the pipeline supplies.
  // Combining the results keeps every violation visible instead of reporting them one stage at a time.
  const dedup = combineValidation(validateDeduplication(enriched));
  if (!dedup.valid) {
    return {
      status: "refused",
      refusal: { code: "validation_failed", violations: dedup.violations },
    };
  }

  // P2-D2 (zero setup): a store with nothing connected has no destination and may have no rule set. The event's only
  // effect is the visitor profile, already updated above; recording it would fill the database for a store that
  // forwards nothing, and refusing it would send every event of an unconnected store to retry and the dead letters.
  const ruleSet = deps.ruleSets.resolve(deps.ruleSetKey);
  if (deps.destinations.listActive().length === 0) {
    return { status: "unrouted", reason: "no_destinations" };
  }
  if (ruleSet === null) return { status: "unrouted", reason: "no_rule_set" };

  const routing = route({ envelope: enriched, ruleSet, destinations: deps.destinations });

  const delivery = await receiveAndDeliver(deps.recording, {
    envelope: enriched,
    routing,
    ...(profileKeys === undefined ? {} : { profileMatchKeys: profileKeys }),
    ...(input.attribution === undefined ? {} : { attribution: input.attribution }),
    ...(input.identityConfidence === undefined
      ? {}
      : { identityConfidence: input.identityConfidence }),
  });

  return { status: "accepted", delivery, routing };
}
