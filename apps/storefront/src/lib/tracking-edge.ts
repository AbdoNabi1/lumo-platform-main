import { createHmac } from "node:crypto";
import { MIN_SECRET_BYTES } from "./storefront-env";

/**
 * Tracking P1-D3: the storefront SERVER's side of `POST /public/tracking/collect` on the runtime API.
 *
 * Server-only by construction: it needs `node:crypto` and the shared secret, neither of which may ever
 * reach a browser (a client import fails the build on `node:crypto`). Nothing calls it yet but tests —
 * the edge middleware (P1-D5) and the same-origin `/_m/*` route (P3) will.
 *
 * The signature is HMAC-SHA256 over `<x-mb-ts>.<exact body bytes>` with `TRACKING_EDGE_SECRET`
 * (`x-mb-ts` = whole Unix seconds); the runtime refuses anything older or newer than five minutes.
 * The body is serialised ONCE and those same bytes are signed and sent. The construction is
 * mirrored by `apps/admin/src/http/tracking-edge-signature.ts`; both test files pin one fixed vector.
 *
 * Fail safe: with no secret configured nothing is sent and nothing throws — a storefront deployed
 * before the owner sets the value simply does not capture. A tracking call never takes a page down.
 */
export const EDGE_SIGNATURE_HEADER = "x-mb-sig";
export const EDGE_TIMESTAMP_HEADER = "x-mb-ts";
export const COLLECT_PATH = "/api/v1/public/tracking/collect";
/** A hung runtime must not hold a storefront request: give up quickly, the caller never awaits this. */
const SEND_TIMEOUT_MS = 3_000;

type Env = Readonly<Record<string, string | undefined>>;

/** The shared secret, or `null` when it is absent or shorter than 32 bytes. Read per call, never logged. */
export function trackingEdgeSecret(env: Env = process.env): string | null {
  const value = env["TRACKING_EDGE_SECRET"];
  return value !== undefined && new TextEncoder().encode(value).length >= MIN_SECRET_BYTES
    ? value
    : null;
}

export interface SignedTrackingHeaders {
  readonly "x-mb-ts": string;
  readonly "x-mb-sig": string;
}

/** Signs `rawBody` as of `nowMs`. The body must be the exact string that is then sent. */
export function signTrackingRequest(
  secret: string,
  rawBody: string,
  nowMs: number = Date.now(),
): SignedTrackingHeaders {
  const timestamp = String(Math.floor(nowMs / 1000));
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest("hex");
  return { "x-mb-ts": timestamp, "x-mb-sig": signature };
}

/** What the storefront knows about the visitor's request (already trusted: P1-D7 resolved the IP). */
export interface TrackingClientContext {
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly pageUrl: string | null;
  readonly referrer: string | null;
  readonly cookies: {
    readonly fbp?: string;
    readonly fbc?: string;
    readonly ttp?: string;
    readonly scid?: string;
    readonly ga?: string;
    readonly visitorId?: string;
    readonly sessionId?: string;
  };
}

export interface SendTrackingEventInput {
  /** The shop THIS storefront resolved from the host — never anything the browser sent. */
  readonly tenantId: string;
  /** The canonical event (`eventName`, `environment`, `consent`, …); the runtime validates it. */
  readonly event: Readonly<Record<string, unknown>>;
  readonly client: TrackingClientContext;
}

/** A cookie the runtime asks the storefront to re-emit first-party (P1-D6; empty until then). */
export interface TrackingCookieDirective {
  readonly name: string;
  readonly value: string;
  readonly maxAgeSeconds: number;
}

export type SendTrackingEventResult =
  | {
      readonly ok: true;
      readonly eventId: string;
      readonly cookies: readonly TrackingCookieDirective[];
    }
  | {
      readonly ok: false;
      /**
       * `not_configured`: no secret here, or the runtime has none (503 NOT_CONFIGURED) — send nothing.
       * `rejected`: a permanent 4xx; retrying the same event cannot help.
       * `unavailable`: 5xx or a network fault; the event id makes a retry idempotent.
       */
      readonly reason: "not_configured" | "rejected" | "unavailable";
    };

export interface SendTrackingEventDeps {
  readonly env?: Env;
  readonly fetchImpl?: typeof fetch;
  readonly nowMs?: () => number;
  readonly runtimeUrl?: string;
}

function parseCookies(value: unknown): readonly TrackingCookieDirective[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const { name, value: cookieValue, maxAgeSeconds } = entry as Record<string, unknown>;
    return typeof name === "string" &&
      typeof cookieValue === "string" &&
      typeof maxAgeSeconds === "number"
      ? [{ name, value: cookieValue, maxAgeSeconds }]
      : [];
  });
}

/**
 * Sends one canonical event to the runtime. Never throws; never sends without the secret. Await it
 * only where the answer is needed — page requests should hand it to `waitUntil`.
 */
export async function sendTrackingEvent(
  input: SendTrackingEventInput,
  deps: SendTrackingEventDeps = {},
): Promise<SendTrackingEventResult> {
  const env = deps.env ?? process.env;
  const secret = trackingEdgeSecret(env);
  if (secret === null) return { ok: false, reason: "not_configured" };

  const rawBody = JSON.stringify({
    tenantId: input.tenantId,
    event: input.event,
    client: input.client,
  });
  const headers = signTrackingRequest(secret, rawBody, (deps.nowMs ?? Date.now)());
  const base = deps.runtimeUrl ?? env["RUNTIME_API_URL"] ?? "http://localhost:3080";

  try {
    const response = await (deps.fetchImpl ?? fetch)(`${base}${COLLECT_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": input.tenantId,
        ...headers,
      },
      body: rawBody,
      cache: "no-store",
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;

    if (response.status === 202 && body !== null && typeof body["eventId"] === "string") {
      return { ok: true, eventId: body["eventId"], cookies: parseCookies(body["cookies"]) };
    }
    if (response.status === 503 && body?.["code"] === "NOT_CONFIGURED") {
      return { ok: false, reason: "not_configured" };
    }
    return {
      ok: false,
      reason: response.status >= 500 || response.status === 429 ? "unavailable" : "rejected",
    };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
