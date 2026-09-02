/**
 * The universal event envelope (doc 16 §1) — one schema for browser, edge and server emitters,
 * validated at the SDK and re-validated at ingest.
 *
 * Every field the Sprint-0.1 stub declared is preserved unchanged (FF-API-01 public-API
 * stability); this module only adds. The added blocks are optional so an existing emitter keeps
 * compiling, while the pipeline's enrichment stages populate them before storage.
 */

import type { ConsentSnapshot } from "./consent";
import type { IdentityContext } from "./identity-context";
import type { TechnicalContext } from "./technical-context";
import type { AttributionContext } from "./attribution-context";
import type { EventPayload } from "./payload";

/** Where an event was emitted (doc 16 §1). */
export type EventSource = "web" | "mobile_web" | "server" | "edge";

/**
 * Which side of the pixel/CAPI pair produced this copy. Both copies of one logical occurrence
 * share a `dedupId` but hold distinct `eventId`s — see `../ids/dedup-id`.
 */
export type EventOrigin = "browser" | "server" | "edge" | "import";

/** `action_source` as the conversions APIs define it. */
export type ActionSource =
  | "website"
  | "app"
  | "email"
  | "chat"
  | "phone_call"
  | "physical_store"
  | "system_generated"
  | "other";

/** Coarse classification driving default validation and routing rules. */
export type EventType = "page" | "track" | "identify" | "screen" | "group" | "alias";

export type EventCategory =
  "commerce" | "engagement" | "lifecycle" | "marketing" | "system" | "custom";

/** Deployment environment; non-production events never reach a live destination. */
export type TrackingEnvironment = "development" | "staging" | "production";

// ---------------------------------------------------------------------------
// Context blocks (Sprint 0.1 shapes, extended additively)
// ---------------------------------------------------------------------------

export interface PageContext {
  readonly url?: string;
  readonly path?: string;
  readonly referrer?: string;
  readonly title?: string;
  readonly pageType?: string;
  readonly locale?: string;
  readonly currency?: string;
  /** Named route/screen, for SPA and native surfaces where `path` is not stable. */
  readonly route?: string;
  readonly screenName?: string;
  /** `event_source_url` — the URL a conversions API attributes the event to. */
  readonly eventSourceUrl?: string;
}

export interface UserContext {
  readonly visitorId?: string;
  readonly clientId?: string;
  readonly customerId?: string;
  readonly householdId?: string;
  readonly isLoggedIn?: boolean;
}

export interface SessionContext {
  readonly sessionId?: string;
  readonly journeyId?: string;
  readonly visitorId?: string;
  /** 1-based position of this page within the session (M7); resets to 1 on session rollover. */
  readonly pageSequence?: number;
  /** Tab-scoped id (M7) — distinguishes concurrent tabs sharing one session/visitor. */
  readonly tabId?: string;
}

export interface DeviceContext {
  readonly deviceType?: string;
  readonly os?: string;
  readonly browser?: string;
  readonly locale?: string;
}

export interface MarketingContext {
  readonly utmSource?: string;
  readonly utmMedium?: string;
  readonly utmCampaign?: string;
  readonly utmTerm?: string;
  readonly utmContent?: string;
}

export interface TrackingContext {
  readonly page?: PageContext;
  readonly user?: UserContext;
  readonly session?: SessionContext;
  readonly device?: DeviceContext;
  readonly marketing?: MarketingContext;
  /** Full identity block (doc 16 §6.1) — supersedes `user` for matching and forwarding. */
  readonly identity?: IdentityContext;
  /** Full technical block (doc 16 §6.3) — supersedes `device`. */
  readonly technical?: TechnicalContext;
  /** Full attribution block (doc 16 §6.4) — supersedes `marketing`. */
  readonly attribution?: AttributionContext;
}

/** Multi-tenant placement. Absent `tenantId` fails validation for any stored event (ADR-0008). */
export interface TenancyContext {
  readonly tenantId?: string;
  readonly storeId?: string;
  readonly workspaceId?: string;
}

/** Distributed-trace correlation, propagated from `@platform/observability`. */
export interface TraceContext {
  readonly requestId?: string;
  readonly traceId?: string;
  readonly spanId?: string;
}

// ---------------------------------------------------------------------------
// The envelope
// ---------------------------------------------------------------------------

/**
 * A single captured occurrence. Immutable once stored (ADR-0032 §9): correction is a new event,
 * never an edit.
 */
export interface TrackingEnvelope<
  TName extends string = string,
  TProps extends Record<string, unknown> = Record<string, unknown>,
> {
  /** UUIDv7, unique per occurrence. **The ingest idempotency key** — never shared across emitters. */
  readonly eventId: string;
  readonly eventName: TName;
  readonly eventVersion: number;
  /**
   * Deterministic key **shared** by the browser and server copies of one logical occurrence, and
   * supplied to each vendor as its dedupe field. Distinct from `eventId` by design (D-077).
   */
  readonly dedupId?: string;
  /** ISO-8601 UTC, millisecond precision, client-asserted. */
  readonly timestamp: string;
  readonly source: EventSource;
  readonly consent: ConsentSnapshot;
  readonly context: TrackingContext;
  readonly properties: TProps;

  // --- added by the Universal Event Platform (ADR-0032) ---

  /** Epoch milliseconds, denormalised for time-series storage and vendor payloads. */
  readonly eventTimestampMs?: number;
  /** Server `received_at`; retained alongside client time to measure and bound clock skew. */
  readonly receivedAt?: string;
  readonly eventOrigin?: EventOrigin;
  readonly actionSource?: ActionSource;
  readonly eventType?: EventType;
  readonly eventCategory?: EventCategory;
  readonly environment?: TrackingEnvironment;

  readonly tenancy?: TenancyContext;
  readonly trace?: TraceContext;

  /** Structured commerce payload; `properties` stays the free-form escape hatch. */
  readonly payload?: EventPayload;
}

/** An envelope after enrichment, where the pipeline guarantees the non-negotiable fields exist. */
export type EnrichedEnvelope<
  TName extends string = string,
  TProps extends Record<string, unknown> = Record<string, unknown>,
> = TrackingEnvelope<TName, TProps> & {
  readonly dedupId: string;
  readonly eventTimestampMs: number;
  readonly receivedAt: string;
  readonly environment: TrackingEnvironment;
  readonly tenancy: TenancyContext & { readonly tenantId: string };
};
