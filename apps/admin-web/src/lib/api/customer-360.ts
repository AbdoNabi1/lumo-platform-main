import { getAdminApi } from "./client";

/**
 * Customer 360 (T3.3) — one fetch function per GET endpoint in
 * `apps/admin/src/http/customer-360-routes.ts` (`customer360:read`). Each route delegates
 * straight through `Customer360Controller` (`services/customer-360/src/interfaces/
 * customer-360.controller.ts`) to a single Sprint-S1 read use-case, and `present()`
 * (`services/customer-360/src/interfaces/presenter.ts`) returns that use-case's output value
 * verbatim — no DTO mapping happens on the backend — so this module is the only place these
 * shapes get narrowed to primitives before use (README.md rule #2).
 *
 * **The Map-over-the-wire gap.** `GetCustomerProfileOutput.freshness`/`.sources`
 * (`services/customer-360/src/application/get-customer-profile.use-case.ts`) and
 * `CustomerProfile.fields` (`services/customer-360/src/domain/customer-profile.ts`) are typed as
 * `ReadonlyMap` on the backend, but `packages/http/src/server.ts`'s route handler calls
 * `reply.status(...).send(response.body)`, which hands the value to Fastify's default
 * `JSON.stringify`-based serializer. `JSON.stringify` has no special handling for `Map` — it has
 * no own enumerable properties, so it always serializes as `{}`, regardless of how many entries
 * it holds. Verified directly against the real `GetCustomerProfile`/`mergeProfiles` code path, not
 * guessed (same class of wire-shape gap `finance.ts`'s `Balance`-over-the-wire comment documents,
 * just an empty object instead of a mis-nested one). This means `profile.fields`, `freshness`, and
 * `sources` arrive as an empty object on every real response today, even when the merged profile
 * actually has fields — a backend serialization bug, out of scope for this read-only frontend task
 * (recorded in `docs/plans/BLOCKERS.md`). This module still types and renders them generically
 * (`Readonly<Record<string, unknown>>`, walked with `Object.entries`) instead of hard-coding
 * today's emptiness, so the UI self-heals the moment the backend is fixed.
 */

// ── Shared ───────────────────────────────────────────────────────────────────────────────────────

/** The identifier types `customer-360-routes.ts`'s `identifierType` param schema accepts — an
 * unrecognized value 422s server-side, so callers are restricted to this exact list. */
export const CUSTOMER_360_IDENTIFIER_TYPES = [
  "visitor_id",
  "client_id",
  "browser_id",
  "device_id",
  "session_id",
  "email_hash",
  "phone_hash",
  "customer_id",
  "external_id",
  "crm_id",
  "loyalty_id",
  "household_id",
] as const;
export type Customer360IdentifierType = (typeof CUSTOMER_360_IDENTIFIER_TYPES)[number];

export interface IdentifierRefDto {
  readonly type: string;
  readonly value: string;
}

function isIdentifierRefDto(value: unknown): value is IdentifierRefDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string" &&
    typeof (value as { value?: unknown }).value === "string"
  );
}

// ── Unified profile ──────────────────────────────────────────────────────────────────────────────

export interface CustomerProfileDto {
  readonly identifierType: string;
  readonly identifierValue: string;
  /** See the module doc's "Map-over-the-wire gap" — currently always `{}` on the real API. */
  readonly fields: Readonly<Record<string, unknown>>;
  readonly version: number;
  readonly updatedAt: string;
}

export interface ProfileConfidenceSummaryDto {
  readonly verified: number;
  readonly inferred: number;
  readonly overall: "verified" | "inferred";
}

export interface CustomerProfileViewDto {
  /** `null` when neither this identifier nor anything in its resolved cluster has a profile yet —
   * a normal, expected state, not an error. */
  readonly profile: CustomerProfileDto | null;
  readonly mergedFrom: readonly IdentifierRefDto[];
  readonly completeness: number | null;
  readonly confidence: ProfileConfidenceSummaryDto | null;
  /** See the module doc's "Map-over-the-wire gap" — currently always `{}` (or `null` alongside a
   * `null` profile) on the real API. */
  readonly freshness: Readonly<Record<string, unknown>> | null;
  readonly sources: Readonly<Record<string, unknown>> | null;
}

function isCustomerProfileDto(value: unknown): value is CustomerProfileDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { identifierType?: unknown }).identifierType === "string" &&
    typeof (value as { identifierValue?: unknown }).identifierValue === "string" &&
    typeof (value as { version?: unknown }).version === "number" &&
    typeof (value as { updatedAt?: unknown }).updatedAt === "string" &&
    typeof (value as { fields?: unknown }).fields === "object" &&
    (value as { fields?: unknown }).fields !== null
  );
}

function isProfileConfidenceSummaryDto(value: unknown): value is ProfileConfidenceSummaryDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { verified?: unknown }).verified === "number" &&
    typeof (value as { inferred?: unknown }).inferred === "number" &&
    ((value as { overall?: unknown }).overall === "verified" ||
      (value as { overall?: unknown }).overall === "inferred")
  );
}

function isCustomerProfileViewDto(value: unknown): value is CustomerProfileViewDto {
  if (typeof value !== "object" || value === null) return false;
  const v = value as {
    profile?: unknown;
    mergedFrom?: unknown;
    completeness?: unknown;
    confidence?: unknown;
    freshness?: unknown;
    sources?: unknown;
  };
  if (v.profile !== null && !isCustomerProfileDto(v.profile)) return false;
  if (!Array.isArray(v.mergedFrom) || !v.mergedFrom.every(isIdentifierRefDto)) return false;
  if (v.completeness !== null && typeof v.completeness !== "number") return false;
  if (v.confidence !== null && !isProfileConfidenceSummaryDto(v.confidence)) return false;
  if (v.freshness !== null && (typeof v.freshness !== "object" || v.freshness === null)) {
    return false;
  }
  if (v.sources !== null && (typeof v.sources !== "object" || v.sources === null)) return false;
  return true;
}

export type FetchCustomerProfileResult =
  | { readonly outcome: "ok"; readonly data: CustomerProfileViewDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/**
 * `GET /customer-360/profile/:identifierType/:identifierValue` — `customer360:read`. The merged
 * Profile Engine view for one identifier. Never actually 404s
 * (`GetCustomerProfile.execute` returns `ok({ profile: null, ... })` when nothing is on file) —
 * the `not_found` outcome is kept for symmetry with every other lookup route and in case that
 * changes, but callers should treat `data.profile === null` as the real "nothing yet" signal.
 */
export async function fetchCustomerProfile(
  identifierType: Customer360IdentifierType,
  identifierValue: string,
): Promise<FetchCustomerProfileResult> {
  const result = await getAdminApi(
    `/api/v1/customer-360/profile/${encodeURIComponent(identifierType)}/${encodeURIComponent(identifierValue)}`,
    isCustomerProfileViewDto,
  );
  if (result.outcome === "ok") return { outcome: "ok", data: result.data };
  if (result.outcome === "unauthorized") return { outcome: "unauthorized" };
  if (result.outcome === "not_found") return { outcome: "not_found" };
  return { outcome: "error", message: result.message };
}

// ── Identity timeline ────────────────────────────────────────────────────────────────────────────

export type IdentityTimelineEntryDto =
  | {
      readonly kind: "observed";
      readonly occurredAt: string;
      readonly counterpartType: string;
      readonly counterpartValue: string;
      readonly confidence: string;
      readonly source: string;
    }
  | {
      readonly kind: "merged" | "split";
      readonly occurredAt: string;
      readonly decisionId: string;
      readonly counterpartType: string;
      readonly counterpartValue: string;
      readonly reason: string;
      readonly actor: string;
    };

export interface IdentityTimelineDto {
  readonly entries: readonly IdentityTimelineEntryDto[];
}

function isIdentityTimelineEntryDto(value: unknown): value is IdentityTimelineEntryDto {
  if (typeof value !== "object" || value === null) return false;
  const v = value as {
    kind?: unknown;
    occurredAt?: unknown;
    counterpartType?: unknown;
    counterpartValue?: unknown;
  };
  return (
    (v.kind === "observed" || v.kind === "merged" || v.kind === "split") &&
    typeof v.occurredAt === "string" &&
    typeof v.counterpartType === "string" &&
    typeof v.counterpartValue === "string"
  );
}

function isIdentityTimelineDto(value: unknown): value is IdentityTimelineDto {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { entries?: unknown }).entries) &&
    (value as { entries: readonly unknown[] }).entries.every(isIdentityTimelineEntryDto)
  );
}

export type FetchIdentityTimelineResult =
  | { readonly outcome: "ok"; readonly data: IdentityTimelineDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/**
 * `GET /customer-360/identity-timeline/:identifierType/:identifierValue` — `customer360:read`.
 * The Identity Engine's own provenance history for one identifier (observed links interleaved
 * with merge/split decisions). Never actually 404s — an identifier with no history simply comes
 * back with an empty `entries` array.
 */
export async function fetchIdentityTimeline(
  identifierType: Customer360IdentifierType,
  identifierValue: string,
): Promise<FetchIdentityTimelineResult> {
  const result = await getAdminApi(
    `/api/v1/customer-360/identity-timeline/${encodeURIComponent(identifierType)}/${encodeURIComponent(identifierValue)}`,
    isIdentityTimelineDto,
  );
  if (result.outcome === "ok") return { outcome: "ok", data: result.data };
  if (result.outcome === "unauthorized") return { outcome: "unauthorized" };
  if (result.outcome === "not_found") return { outcome: "not_found" };
  return { outcome: "error", message: result.message };
}

// ── Journeys (keyed on visitorId, not customerId) ───────────────────────────────────────────────

export type SessionTimelineEntryDto =
  | {
      readonly kind: "session_started" | "session_activity" | "session_closed";
      readonly occurredAt: string;
      readonly sessionId: string;
      readonly closeReason?: string;
    }
  | {
      readonly kind: "transition";
      readonly occurredAt: string;
      readonly transitionId: string;
      readonly transitionKind: string;
      readonly fromSessionId?: string;
      readonly toSessionId?: string;
      readonly reason?: string;
      readonly actor?: string;
    };

export interface JourneyTimelineDto {
  readonly entries: readonly SessionTimelineEntryDto[];
}

function isSessionTimelineEntryDto(value: unknown): value is SessionTimelineEntryDto {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { kind?: unknown; occurredAt?: unknown };
  if (typeof v.occurredAt !== "string") return false;
  if (
    v.kind === "session_started" ||
    v.kind === "session_activity" ||
    v.kind === "session_closed"
  ) {
    return typeof (value as { sessionId?: unknown }).sessionId === "string";
  }
  if (v.kind === "transition") {
    return (
      typeof (value as { transitionId?: unknown }).transitionId === "string" &&
      typeof (value as { transitionKind?: unknown }).transitionKind === "string"
    );
  }
  return false;
}

function isJourneyTimelineDto(value: unknown): value is JourneyTimelineDto {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { entries?: unknown }).entries) &&
    (value as { entries: readonly unknown[] }).entries.every(isSessionTimelineEntryDto)
  );
}

export type FetchJourneyTimelineResult =
  | { readonly outcome: "ok"; readonly data: JourneyTimelineDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/**
 * `GET /customer-360/journeys/:visitorId/timeline` — `customer360:read`. The Session-Stitching
 * Engine's own history for one visitor (session lifecycle events interleaved with journey
 * transitions). Keyed on `visitorId`, never `customerId` — see the module's callers for how that
 * identifier is sourced (never fabricated).
 */
export async function fetchJourneyTimeline(visitorId: string): Promise<FetchJourneyTimelineResult> {
  const result = await getAdminApi(
    `/api/v1/customer-360/journeys/${encodeURIComponent(visitorId)}/timeline`,
    isJourneyTimelineDto,
  );
  if (result.outcome === "ok") return { outcome: "ok", data: result.data };
  if (result.outcome === "unauthorized") return { outcome: "unauthorized" };
  if (result.outcome === "not_found") return { outcome: "not_found" };
  return { outcome: "error", message: result.message };
}

export interface JourneyStateDto {
  readonly visitorId: string;
  readonly sessionCount: number;
  readonly currentSessionId?: string;
  readonly firstSeenAt?: string;
  readonly lastActivityAt?: string;
  readonly identified: boolean;
}

interface JourneyStateViewDto {
  readonly state: JourneyStateDto;
}

function isJourneyStateDto(value: unknown): value is JourneyStateDto {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { visitorId?: unknown }).visitorId === "string" &&
    typeof (value as { sessionCount?: unknown }).sessionCount === "number" &&
    typeof (value as { identified?: unknown }).identified === "boolean"
  );
}

function isJourneyStateViewDto(value: unknown): value is JourneyStateViewDto {
  return (
    typeof value === "object" &&
    value !== null &&
    isJourneyStateDto((value as { state?: unknown }).state)
  );
}

export type FetchJourneyStateResult =
  | { readonly outcome: "ok"; readonly data: JourneyStateDto }
  | { readonly outcome: "unauthorized" }
  | { readonly outcome: "not_found" }
  | { readonly outcome: "error"; readonly message: string };

/**
 * `GET /customer-360/journeys/:visitorId/state` — `customer360:read`. A visitor's current
 * position in their own journey (session count, current open session, span, identified/anonymous).
 * Keyed on `visitorId`, never `customerId`.
 */
export async function fetchJourneyState(visitorId: string): Promise<FetchJourneyStateResult> {
  const result = await getAdminApi(
    `/api/v1/customer-360/journeys/${encodeURIComponent(visitorId)}/state`,
    isJourneyStateViewDto,
  );
  if (result.outcome === "ok") return { outcome: "ok", data: result.data.state };
  if (result.outcome === "unauthorized") return { outcome: "unauthorized" };
  if (result.outcome === "not_found") return { outcome: "not_found" };
  return { outcome: "error", message: result.message };
}
