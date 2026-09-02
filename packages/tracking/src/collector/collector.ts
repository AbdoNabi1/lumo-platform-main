/**
 * The public Collector (P0-1) — the platform's only entrance for browser-emitted events.
 *
 * ```
 * Browser → Collector → tracking.event.captured.v1 → Tracking Runtime → Pipeline → Router → Delivery
 * ```
 *
 * ## What the Collector is, and what it must never become
 *
 * It **parses, validates, resolves and publishes**. It resolves the things only a server can know —
 * the client IP, the user agent, first-party cookies, the session — completes the envelope, and
 * publishes exactly one event. Then it stops.
 *
 * It **never executes the pipeline.** Not normalization, not identity stitching, not consent
 * resolution, not attribution, not hashing, not mapping, and above all not delivery. This module
 * imports nothing from `../runtime/`, `../delivery/` or `../pipeline/` beyond the shared validator,
 * and `FF-ARCH-09` fails the build if the collector app reaches for the runtime. The reason is
 * ordering: the pipeline's guarantees depend on stages running once, in sequence, over a recorded
 * event. A collector that "just normalized the email first" would produce events that the pipeline
 * then normalizes again, and `DoubleHashError` exists because that class of mistake is otherwise
 * silent.
 *
 * The one bridge is the topic. Publishing is the whole contract.
 *
 * ## Why the browser is not trusted for tenancy
 *
 * This endpoint is public and unauthenticated — anyone can POST to it. If the tenant came from the
 * request body, any visitor could write events into any merchant's account, and every one of those
 * events would look perfectly well-formed for the rest of its life. So the tenant is resolved
 * **server-side, from the write key**, and a body-supplied `tenancy.tenantId` is discarded rather
 * than merged. An unknown write key is refused.
 *
 * ## Why so little is invented
 *
 * The collector mints exactly three things, and each is something only the server can state: the
 * `receivedAt` instant, an `eventId` when the SDK did not supply one, and a session/visitor id when
 * no cookie exists. It does **not** invent `environment` (defaulting either way is unrecoverable —
 * see `ingest-runtime`), and it does not invent consent. Absent consent is treated as *no consent
 * granted*, which is the fail-closed reading D-077 requires.
 */

import type { TrackingEnvelope, EventSource } from "../envelope/envelope";
import type { ConsentSnapshot } from "../envelope/consent";
import type { CapturedClickId } from "../envelope/click-ids";
import { extractClickIds } from "../envelope/click-ids";
import { validateEnvelope, type ValidationViolation } from "../pipeline/validation";
import {
  COLLECTOR_COOKIES,
  deriveFbc,
  resolveClientIp,
  resolveCookies,
  resolveUserAgent,
  type ClientIpPolicy,
  type CookieLookup,
  type HeaderLookup,
} from "./client-context";

/** The bridge topic. Named here so the collector and the consumer cannot drift apart. */
export const TRACKING_CAPTURED_TOPIC = "tracking.event.captured";
export const TRACKING_CAPTURED_VERSION = 1;

/**
 * The payload carried on the bridge topic: the raw envelope, unprocessed.
 *
 * Declared in the package rather than in either app because the producer (`apps/collector`) and the
 * consumer (`apps/runtime`) are separate deployables that must agree exactly. Two local copies of
 * this interface would compile independently and diverge silently the first time one side added a
 * field — and the symptom would be events that decode but read as empty.
 */
export interface TrackingCapturedEventPayload {
  readonly envelope: TrackingEnvelope;
}

/**
 * Resolves a public write key to the tenant that owns it.
 *
 * A port, because the mapping is durable configuration the collector must not own. Returning `null`
 * for an unknown key is a refusal, never a fallback to a default tenant.
 */
export interface WriteKeyResolverPort {
  resolve(writeKey: string): { readonly tenantId: string; readonly storeId?: string } | null;
}

export interface CollectorRequest {
  /** The decoded JSON body as sent by the browser SDK. Untrusted. */
  readonly body: unknown;
  readonly headers: HeaderLookup;
  readonly cookies: CookieLookup;
  /** Socket peer address, when the transport exposes one. */
  readonly remoteAddress?: string;
}

export interface CollectorDeps {
  readonly writeKeys: WriteKeyResolverPort;
  readonly idGenerator: { generate(): string };
  readonly clock: { now(): Date };
  readonly ipPolicy: ClientIpPolicy;
}

/** Why a request was not accepted. Every one is explicit; none is a silent drop. */
export type CollectorRefusal =
  | { readonly code: "malformed_body"; readonly detail: string }
  | { readonly code: "write_key_missing" }
  | { readonly code: "write_key_unknown" }
  | { readonly code: "environment_unknown" }
  | { readonly code: "validation_failed"; readonly violations: readonly ValidationViolation[] };

/** A cookie the transport should set on the response, so the next request carries it. */
export interface CookieDirective {
  readonly name: string;
  readonly value: string;
  readonly maxAgeSeconds: number;
}

export type CollectorOutcome =
  | {
      readonly status: "accepted";
      readonly envelope: TrackingEnvelope;
      /** First-party ids minted this request. Empty when the browser already had them. */
      readonly cookies: readonly CookieDirective[];
    }
  | { readonly status: "refused"; readonly refusal: CollectorRefusal };

/** A visitor id outlives sessions; a session id rolls after inactivity. Both first-party. */
const VISITOR_TTL_SECONDS = 400 * 24 * 60 * 60; // 400d — the browser cap for a Set-Cookie lifetime
const SESSION_TTL_SECONDS = 30 * 60;

/** The shape the browser SDK posts. Every field is untrusted and optional until validated. */
interface CollectorBody {
  readonly writeKey?: unknown;
  readonly event?: unknown;
}

/**
 * Parse → resolve → validate → hand back a publishable envelope.
 *
 * Pure: it performs no I/O and publishes nothing. The transport publishes the returned envelope to
 * {@link TRACKING_CAPTURED_TOPIC}, and that separation is what makes every branch here testable
 * without a broker.
 */
export function collect(request: CollectorRequest, deps: CollectorDeps): CollectorOutcome {
  // --- 1. Parse -----------------------------------------------------------
  const parsed = parseBody(request.body);
  if ("refusal" in parsed) return { status: "refused", refusal: parsed.refusal };
  const { writeKey, event } = parsed;

  // --- 2. Resolve tenancy from the write key, never from the body ---------
  const owner = deps.writeKeys.resolve(writeKey);
  if (owner === null) return { status: "refused", refusal: { code: "write_key_unknown" } };

  const environment = asString(event["environment"]);
  if (environment === undefined) {
    // Not defaulted, for the same reason the ingest runtime refuses: guessing `production` forwards
    // development traffic to live ad platforms, guessing `development` silently discards revenue.
    return { status: "refused", refusal: { code: "environment_unknown" } };
  }

  const now = deps.clock.now();
  const nowMs = now.getTime();

  // --- 3. Resolve client context ------------------------------------------
  const clientIp = resolveClientIp(request.headers, request.remoteAddress, deps.ipPolicy);
  const userAgent = resolveUserAgent(request.headers);
  const cookies = resolveCookies(request.cookies);

  // --- 4. Resolve session and visitor -------------------------------------
  const minted: CookieDirective[] = [];

  let visitorId = cookies.visitorId;
  if (visitorId === undefined) {
    visitorId = deps.idGenerator.generate();
    minted.push({
      name: COLLECTOR_COOKIES.visitorId,
      value: visitorId,
      maxAgeSeconds: VISITOR_TTL_SECONDS,
    });
  }

  let sessionId = cookies.sessionId;
  if (sessionId === undefined) {
    sessionId = deps.idGenerator.generate();
  }
  // Re-issued on every request, not only when minted: the max-age is what slides the session window
  // forward. Only refreshing it at creation would expire an actively browsing visitor mid-session.
  minted.push({
    name: COLLECTOR_COOKIES.sessionId,
    value: sessionId,
    maxAgeSeconds: SESSION_TTL_SECONDS,
  });

  // --- 5. Resolve click ids from the TRACKED PAGE's url -------------------
  //
  // Not from this request's query string. The beacon POSTs to the collector endpoint, so the click
  // identifiers live in the URL of the page the visitor actually landed on, which arrives in the
  // body. Reading the collector's own query string would find nothing and silently lose every click.
  const pageContext = asRecord(event["context"])?.["page"];
  const pageUrl = asString(asRecord(pageContext)?.["url"]);
  const clickIds = extractClickIds(queryLookupFor(pageUrl), now.toISOString());

  const metaIds = resolveMetaIds(cookies.fbp, cookies.fbc, clickIds, nowMs);

  // --- 6. Compose the envelope --------------------------------------------
  const envelope = composeEnvelope({
    event,
    owner,
    environment,
    now,
    eventId: asString(event["eventId"]) ?? deps.idGenerator.generate(),
    sessionId,
    visitorId,
    clientIp: clientIp.ip,
    userAgent,
    clickIds,
    metaIds,
  });

  // --- 7. Validate the COMPLETED envelope ---------------------------------
  //
  // After resolution, not before: several invariants (tenancy, receivedAt, clock skew) are about
  // fields the collector supplies, so validating the raw body would check a document that is not the
  // one being published. This is the same validator the ingest runtime runs — deliberately the same
  // function, so an event the collector accepts cannot be rejected at ingest for a different reading
  // of the same rule.
  const validation = validateEnvelope(envelope, { now });
  if (!validation.valid) {
    return {
      status: "refused",
      refusal: { code: "validation_failed", violations: validation.violations },
    };
  }

  return { status: "accepted", envelope, cookies: minted };
}

/** Permanent refusals: retrying the identical request cannot change the outcome. */
export const PERMANENT_COLLECTOR_REFUSALS: readonly CollectorRefusal["code"][] = [
  "malformed_body",
  "write_key_missing",
  "write_key_unknown",
  "environment_unknown",
  "validation_failed",
];

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function parseBody(
  body: unknown,
): { writeKey: string; event: Record<string, unknown> } | { refusal: CollectorRefusal } {
  const root = asRecord(body) as CollectorBody | undefined;
  if (root === undefined) {
    return { refusal: { code: "malformed_body", detail: "body is not a JSON object" } };
  }

  const writeKey = asString(root.writeKey);
  if (writeKey === undefined) return { refusal: { code: "write_key_missing" } };

  const event = asRecord(root.event);
  if (event === undefined) {
    return { refusal: { code: "malformed_body", detail: "`event` is missing or not an object" } };
  }

  return { writeKey, event };
}

interface ComposeInput {
  readonly event: Record<string, unknown>;
  readonly owner: { readonly tenantId: string; readonly storeId?: string };
  readonly environment: string;
  readonly now: Date;
  readonly eventId: string;
  readonly sessionId: string;
  readonly visitorId: string;
  readonly clientIp: string | undefined;
  readonly userAgent: ReturnType<typeof resolveUserAgent>;
  readonly clickIds: readonly CapturedClickId[];
  readonly metaIds: { readonly fbp?: string; readonly fbc?: string };
}

function composeEnvelope(input: ComposeInput): TrackingEnvelope {
  const { event } = input;
  const context = asRecord(event["context"]) ?? {};
  const session = asRecord(context["session"]) ?? {};
  const technical = asRecord(context["technical"]) ?? {};
  const attribution = asRecord(context["attribution"]) ?? {};

  return {
    ...(event as Partial<TrackingEnvelope>),
    eventId: input.eventId,
    eventName: asString(event["eventName"]) ?? "",
    eventVersion: asNumber(event["eventVersion"]) ?? 1,
    timestamp: asString(event["timestamp"]) ?? input.now.toISOString(),
    source: (asString(event["source"]) ?? "web") as EventSource,
    // Only a server can state this, and it is what bounds client clock skew at validation.
    receivedAt: input.now.toISOString(),
    eventOrigin: "browser",
    environment: input.environment as TrackingEnvelope["environment"],
    consent: resolveConsent(event["consent"]),
    // Resolved server-side from the write key. A body-supplied tenantId is discarded, not merged:
    // this endpoint is public, so an attacker-chosen tenant must not survive anywhere.
    tenancy: {
      tenantId: input.owner.tenantId,
      ...(input.owner.storeId === undefined ? {} : { storeId: input.owner.storeId }),
    },
    context: {
      ...context,
      session: {
        ...session,
        sessionId: input.sessionId,
        visitorId: input.visitorId,
      },
      technical: {
        ...technical,
        // Server-observed values overwrite anything the browser claimed. A client-asserted IP or UA
        // is not evidence of anything; these two fields feed vendor match quality directly.
        ...(input.clientIp === undefined ? {} : { clientIpAddress: input.clientIp }),
        ...(input.userAgent.clientUserAgent === undefined
          ? {}
          : { clientUserAgent: input.userAgent.clientUserAgent }),
        deviceType: input.userAgent.deviceType,
      },
      attribution: {
        ...attribution,
        // Merged, never replaced: a page view carrying no click id must not erase the ids captured
        // on the landing that started the journey.
        ...(input.clickIds.length === 0 ? {} : { clickIds: input.clickIds }),
        ...(input.metaIds.fbp === undefined && input.metaIds.fbc === undefined
          ? {}
          : { meta: input.metaIds }),
      },
    },
    properties: asRecord(event["properties"]) ?? {},
  };
}

/**
 * Reads the consent block, **failing closed**.
 *
 * An absent or malformed consent block means "no consent granted", never "consent assumed". D-077
 * makes consent mandatory and fail-closed, and this is the point where a permissive default would be
 * easiest to introduce and hardest to notice: every event would still flow, and the only symptom
 * would be forwarding data the visitor declined.
 */
function resolveConsent(raw: unknown): ConsentSnapshot {
  const consent = asRecord(raw);
  if (consent === undefined) {
    return { analytics: false, marketing: false, personalization: false };
  }

  return {
    ...consent,
    analytics: consent["analytics"] === true,
    marketing: consent["marketing"] === true,
    personalization: consent["personalization"] === true,
  };
}

/** `_fbc` is derived only when Meta's pixel has not already set it — see `deriveFbc`. */
function resolveMetaIds(
  fbp: string | undefined,
  fbc: string | undefined,
  clickIds: readonly CapturedClickId[],
  nowMs: number,
): { fbp?: string; fbc?: string } {
  const fbclid = clickIds.find((id) => id.name === "fbclid");
  const resolvedFbc = fbc ?? (fbclid === undefined ? undefined : deriveFbc(fbclid.value, nowMs));

  return {
    ...(fbp === undefined ? {} : { fbp }),
    ...(resolvedFbc === undefined ? {} : { fbc: resolvedFbc }),
  };
}

/**
 * A query lookup over the tracked page's URL.
 *
 * Hand-parsed rather than via `new URL()` so this module keeps its no-runtime-globals property and
 * runs unchanged in a V8 isolate. A malformed URL yields a lookup that finds nothing, which loses
 * click ids for that event but never rejects it — an unparseable page URL is not grounds to discard
 * a real conversion.
 */
function queryLookupFor(url: string | undefined): (param: string) => string | undefined {
  const params = new Map<string, string>();
  const start = url === undefined ? -1 : url.indexOf("?");

  if (url !== undefined && start >= 0) {
    const query = url.slice(start + 1).split("#")[0] ?? "";
    for (const pair of query.split("&")) {
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = decodeParam(pair.slice(0, eq));
      if (!params.has(name)) params.set(name, decodeParam(pair.slice(eq + 1)));
    }
  }

  return (param: string): string | undefined => params.get(param);
}

function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
