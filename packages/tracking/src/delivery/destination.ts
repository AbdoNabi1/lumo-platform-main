/**
 * Destination contracts (directive §Destination Adapters, §Registry Versioning).
 *
 * Every destination implements **one** interface and carries **no platform-specific code inside
 * the engine**: what makes Meta different from TikTok is a mapping profile and an endpoint
 * descriptor — both configuration held in the Registry — not a branch in the router.
 *
 * Tracking is the **execution layer only**. It owns no destination, mapper, validator, rule set,
 * transformer or pipeline definition; it resolves them through Registry ports.
 */

import type { EvaluationContext } from "@platform/expression";

import type { EnrichedEnvelope } from "../envelope/envelope";
import type { ConsentPurpose } from "../envelope/consent";

/** Stable identifier of a configured destination, e.g. `meta.capi.main`. */
export type DestinationKey = string;

/**
 * Transport family. A new vendor that speaks CAPI-shaped HTTP/JSON needs **no new transport** —
 * only a profile and a descriptor.
 */
export type DestinationTransport = "http_json" | "http_form" | "noop";

/**
 * How a destination receives an event. `browser` and `server` copies of one occurrence share a
 * `dedupId` so the vendor collapses them (D-077).
 */
export type DeliveryChannel = "server" | "browser";

/**
 * A destination definition — the value stored in the Registry. Pure configuration: no functions,
 * so it serializes, versions, diffs and round-trips through an admin surface.
 */
export interface DestinationDefinition {
  readonly key: DestinationKey;
  /** Vendor family, for health grouping and diagnostics. */
  readonly platform: string;
  readonly transport: DestinationTransport;
  readonly channel: DeliveryChannel;
  /** Consent purpose this destination requires. Marketing destinations gate on ad consent. */
  readonly consentPurpose: ConsentPurpose;
  /** Registry key of the mapping profile that shapes the payload. */
  readonly mappingProfileKey: string;
  readonly endpoint: EndpointDescriptor;
  readonly retry: RetryDescriptor;
  readonly rateLimit?: RateLimitDescriptor;
  readonly circuitBreaker?: CircuitBreakerDescriptor;
  /** Disabled destinations resolve but never receive events. */
  readonly enabled: boolean;
}

/**
 * Where and how to call the vendor. Credentials are **references**, never values — secrets live in
 * Vault (doc 27 principle 8) and are resolved at the composition root.
 */
export interface EndpointDescriptor {
  readonly url: string;
  readonly method: "POST" | "GET" | "PUT";
  readonly headers?: Readonly<Record<string, string>>;
  /** Vault reference for the credential, e.g. `vault://tracking/meta/access_token`. */
  readonly credentialRef?: string;
  readonly timeoutMs: number;
}

export interface RetryDescriptor {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly factor: number;
  readonly maxDelayMs: number;
}

export interface RateLimitDescriptor {
  readonly requestsPerSecond: number;
  readonly burst: number;
}

export interface CircuitBreakerDescriptor {
  readonly failureThreshold: number;
  readonly resetTimeoutMs: number;
  /** Successes required in half-open before closing. */
  readonly halfOpenSuccesses: number;
}

// ---------------------------------------------------------------------------
// The one adapter interface
// ---------------------------------------------------------------------------

/** A formatted, ready-to-send payload. The engine never knows its vendor shape. */
export interface DeliveryRequest {
  readonly destination: DestinationKey;
  readonly endpoint: EndpointDescriptor;
  readonly payload: Readonly<Record<string, unknown>>;
  /** Shared cross-emitter key, so the vendor deduplicates the pixel/CAPI pair. */
  readonly dedupId: string;
  readonly eventId: string;
}

/**
 * Vendor outcome. `retryable` is the adapter's judgement — only it knows which of the vendor's
 * error codes are transient — and it is what decides retry versus dead-letter.
 */
export interface DeliveryResponse {
  readonly ok: boolean;
  readonly statusCode?: number;
  readonly retryable: boolean;
  readonly error?: string;
  readonly latencyMs: number;
  /** Vendor-returned diagnostics, surfaced verbatim in the inspector. */
  readonly vendorResponse?: Readonly<Record<string, unknown>>;
}

/**
 * The single interface every destination implements. Adapters are resolved from a registry by
 * `transport` — there is no switch on platform anywhere in the engine.
 */
export interface DestinationAdapter {
  readonly transport: DestinationTransport;
  send(request: DeliveryRequest): Promise<DeliveryResponse>;
}

// ---------------------------------------------------------------------------
// Registry ports — tracking consumes, never owns
// ---------------------------------------------------------------------------

/**
 * Registry-backed lookups. Tracking holds **no persistence** for any of these; the Registry Engine
 * is the single source of truth for destinations, mappers, validators, rule sets, transformers,
 * pipelines, destination versions and plugins.
 */
export interface DestinationRegistryPort {
  /** Current active definition, or null when unknown, disabled-by-lifecycle or retired. */
  resolve(key: DestinationKey): DestinationDefinition | null;
  /** A specific historical version — the mechanism behind rollback and replay. */
  resolveVersion(key: DestinationKey, version: number): DestinationDefinition | null;
  listActive(): readonly DestinationDefinition[];
}

export interface AdapterRegistryPort {
  resolve(transport: DestinationTransport): DestinationAdapter | null;
}

/**
 * Registry lifecycle vocabulary used by the admin surface, mapped onto the four platform-wide
 * states the Registry Engine defines (`draft`/`active`/`deprecated`/`retired`). The registry is
 * not extended — this is the vocabulary mapping it explicitly invites.
 */
export type DestinationStatus = "draft" | "published" | "deprecated" | "archived";

export const DESTINATION_STATUS_TO_REGISTRY: Readonly<
  Record<DestinationStatus, "draft" | "active" | "deprecated" | "retired">
> = {
  draft: "draft",
  published: "active",
  deprecated: "deprecated",
  archived: "retired",
};

export const REGISTRY_TO_DESTINATION_STATUS: Readonly<
  Record<"draft" | "active" | "deprecated" | "retired", DestinationStatus>
> = {
  draft: "draft",
  active: "published",
  deprecated: "deprecated",
  retired: "archived",
};

/**
 * The event, flattened for expression evaluation. It **is** the kernel's evaluation context — an
 * alias rather than a parallel type, so it can never drift out of what `@platform/expression` can
 * actually evaluate.
 *
 * One context serves two readers: routing rules (which read a handful of decision fields) and the
 * mapping engine (which reads whatever a vendor's profile references). They deliberately share one
 * projection. A second builder for mapping would be a second definition of "what this event is",
 * and the two would disagree the first time a field was added to only one of them.
 */
export type RoutingContext = EvaluationContext;

/**
 * Flattens an envelope into the evaluation context.
 *
 * **The projection must cover every path a mapping profile can reference.** This was under-built
 * until M6.6: it emitted only the routing decision fields, so a real event evaluated against a real
 * vendor profile failed its `required` sources and rendered no payload at all — every event was
 * recorded `blocked` and nothing reached a destination. Nothing caught it, because routing and
 * mapping were only ever exercised separately, and a blocked destination looks like a correctly
 * withheld one. Fields are additive; every path that existed before still resolves identically.
 *
 * PII appears here in whatever state the pipeline has left it — raw inside the boundary, SHA-256
 * on the way out. That is why the hashing stage must run *before* rendering, and why the delivery
 * gate re-checks `hashStatus` rather than trusting stage order.
 */
export function toRoutingContext(envelope: EnrichedEnvelope): RoutingContext {
  const identity = envelope.context.identity;
  const attribution = envelope.context.attribution;
  const technical = envelope.context.technical;
  const page = envelope.context.page;

  // Click ids are exposed by name (`attribution.gclid`, `attribution.ttclid`, …) because that is
  // how a vendor profile references the one identifier it cares about. The array stays available
  // for rules that need the whole set.
  const clickIds: Record<string, string> = {};
  for (const captured of attribution?.clickIds ?? []) clickIds[captured.name] = captured.value;

  return {
    event: {
      name: envelope.eventName,
      version: envelope.eventVersion,
      category: envelope.eventCategory ?? null,
      origin: envelope.eventOrigin ?? null,
      environment: envelope.environment,
      dedupId: envelope.dedupId,
      eventId: envelope.eventId,
      timestamp: envelope.timestamp,
      timestampMs: envelope.eventTimestampMs,
      source: envelope.source,
      actionSource: envelope.actionSource ?? null,
    },
    payload: {
      valueMinor: envelope.payload?.valueMinor ?? null,
      currency: envelope.payload?.currency ?? null,
      numItems: envelope.payload?.numItems ?? null,
      orderId: envelope.payload?.orderId ?? null,
    },
    identity: {
      country: identity?.country ?? null,
      authenticated: identity?.authenticated ?? false,
      hasEmail: (identity?.email ?? "") !== "",
      clientId: identity?.clientId ?? envelope.context.user?.clientId ?? null,
      customerId: identity?.customerId ?? envelope.context.user?.customerId ?? null,
      externalId: identity?.externalId ?? null,
      anonymousId: identity?.anonymousId ?? null,
      email: identity?.email ?? null,
      phone: identity?.phone ?? null,
      firstName: identity?.firstName ?? null,
      lastName: identity?.lastName ?? null,
      city: identity?.city ?? null,
      state: identity?.state ?? null,
      postalCode: identity?.postalCode ?? null,
      hashStatus: identity?.hashStatus ?? null,
    },
    attribution: {
      channelGroup: attribution?.channelGroup ?? null,
      campaign: attribution?.campaign ?? null,
      utmSource: attribution?.utmSource ?? null,
      utmMedium: attribution?.utmMedium ?? null,
      utmCampaign: attribution?.utmCampaign ?? null,
      referrer: attribution?.referrer ?? null,
      journeyId: attribution?.journeyId ?? null,
      meta: { fbp: attribution?.meta?.fbp ?? null, fbc: attribution?.meta?.fbc ?? null },
      ...clickIds,
    },
    technical: {
      clientIpAddress: technical?.clientIpAddress ?? null,
      clientUserAgent: technical?.clientUserAgent ?? null,
      deviceType: technical?.deviceType ?? null,
      osName: technical?.osName ?? null,
      browserName: technical?.browserName ?? null,
    },
    page: {
      url: page?.url ?? null,
      path: page?.path ?? null,
      referrer: page?.referrer ?? null,
      title: page?.title ?? null,
      eventSourceUrl: page?.eventSourceUrl ?? page?.url ?? null,
    },
    session: {
      sessionId: envelope.context.session?.sessionId ?? null,
      journeyId: envelope.context.session?.journeyId ?? null,
    },
    consent: {
      analytics: envelope.consent.analytics,
      marketing: envelope.consent.marketing,
      personalization: envelope.consent.personalization,
    },
    tenancy: { tenantId: envelope.tenancy.tenantId },
  };
}
