/**
 * "Send a test event" for one ad platform (Tracking P2-D11).
 *
 * Builds ONE synthetic purchase (`test_<uuid>`, 100.00 EGP, a made-up customer) with the same mappers and the same
 * vendor builders a real order goes through, and posts it to the platform's own endpoint with the shop's own sealed
 * token, so the merchant sees it arrive in Events Manager within seconds of saving a connection.
 *
 * - Meta, TikTok: the test code is REQUEST-scoped. It is the one the merchant typed, else the connection's saved one;
 *   it is put in this one request body and nowhere else (the saved code is never written, there is no write path here).
 *   Neither => `TEST_CODE_REQUIRED`. Vendors keep a test-coded event out of their reporting.
 * - GA4: `/debug/mp/collect`, which validates the request and records nothing; the validation messages come back.
 * - Snap has no test mode and Google Ads has no server events: `TEST_NOT_SUPPORTED`.
 *
 * A test event is NOT an event: it is not appended to an event record store, not published, not routed through
 * ingest, not retried and not replayable. This class has no dependency that could do any of that.
 *
 * Secrets: the token is opened by the connection reader, handed to `HttpJsonAdapter` (which presents it the way the
 * vendor expects and redacts it from anything it returns), and is in no result, no message and no log line. Raw
 * customer fields exist only in the synthetic read model and are hashed before the builder sees them; the result and
 * the log carry platform, status and counts only.
 */

import type { ConnectionsForDelivery, LiveConnection } from "@platform/ad-platforms";
import {
  HttpJsonAdapter,
  MATCH_PLATFORM_OF,
  applyConsentPolicy,
  buildVendorPayload,
  callingCodeForCurrency,
  normalizeIdentity,
  platformMatchKeys,
  purchaseEnvelope,
  vendorEventInputFrom,
  type EnrichedEnvelope,
  type HashPort,
  type HttpTransportPort,
  type OrderTrackingReadModel,
  type TestEventFailureCode,
  type TestEventOutcome,
  type TestEventRequest,
  type TestEventResult,
  type TestEventService,
} from "@platform/tracking";

import { destinationFor, type ServerPlatform } from "./ad-platform-destinations";
import { NodeHashPort } from "./tracking-adapters";

const TESTABLE: readonly ServerPlatform[] = ["meta", "tiktok", "ga4"];
const CODE_PLATFORMS: readonly ServerPlatform[] = ["meta", "tiktok"];

/** A vendor's debug text is advice for a human: a handful of short lines, never a dump. */
const MAX_MESSAGES = 10;
const MAX_MESSAGE_LENGTH = 300;

/** The store address when nothing names it. A valid https address the vendors accept in a test. */
const FALLBACK_STORE_URL = "https://example.com/";

const TEST_CURRENCY = "EGP";
const TEST_AMOUNT_MINOR = 10_000;

const NOT_SUPPORTED: Readonly<Record<string, string>> = {
  snap:
    "Snapchat has no test mode for server events, so we can't send a test event. " +
    "To check your setup, open Snapchat Events Manager and look at your pixel's Activity after a real order.",
  google_ads:
    "Google Ads conversions are sent from the browser, not from our server, so there is no server test event. " +
    "Use Google Tag Assistant on your store to check them.",
};

const CODE_REQUIRED: Readonly<Record<string, string>> = {
  meta:
    "Enter a test code first. In Meta Events Manager open your pixel, choose Test events, " +
    "then Test server events. The code is shown there (it looks like TEST12345).",
  tiktok:
    "Enter a test code first. In TikTok Events Manager open your pixel, choose Test Events, " +
    "then Server events. The code is shown there (it looks like TEST12345).",
};

export interface TestEventSenderDeps {
  readonly connections: Pick<ConnectionsForDelivery, "listLive">;
  readonly transport: HttpTransportPort;
  /** `https://<store domain>/` for `event_source_url`; `null` or an error falls back to a fixed valid address. */
  readonly storeUrls: { storeUrlOf(tenantId: string): Promise<string | null> };
  readonly clock: { now(): Date };
  /** A fresh UUID per send. */
  readonly newId: () => string;
  readonly hasher?: HashPort;
  /** Counts only: platform and outcome, never a value. */
  readonly logger?: { info(message: string, fields?: Record<string, unknown>): void };
}

function isTestable(platform: string): platform is ServerPlatform {
  return (TESTABLE as readonly string[]).includes(platform);
}

function failure(code: TestEventFailureCode, message: string): TestEventOutcome {
  return { ok: false, code, message };
}

function syntheticOrder(orderId: string, placedAt: string): OrderTrackingReadModel {
  return {
    orderId,
    currency: TEST_CURRENCY,
    totals: {
      subtotalMinor: TEST_AMOUNT_MINOR,
      discountMinor: 0,
      taxMinor: 0,
      shippingMinor: 0,
      taxIncluded: true,
    },
    lines: [
      {
        productRef: "test-product",
        name: "Test product",
        unitPriceMinor: TEST_AMOUNT_MINOR,
        quantity: 1,
      },
    ],
    customer: { customerRef: "test-customer", email: "test.event@example.com", name: "Test Event" },
    shipping: { city: "Cairo", country: "EG" },
    placedAt,
    // Documentation address (RFC 5737): never a real visitor.
    snapshot: { ip: "203.0.113.7", userAgent: "Mozilla/5.0 (compatible; MorbehTestEvent/1.0)" },
  };
}

function messagesOf(vendorResponse: Readonly<Record<string, unknown>> | undefined): string[] {
  const raw = vendorResponse?.validationMessages;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (out.length >= MAX_MESSAGES) break;
    if (typeof item !== "object" || item === null) continue;
    const entry = item as Record<string, unknown>;
    const path = typeof entry.fieldPath === "string" ? entry.fieldPath : "";
    const description = typeof entry.description === "string" ? entry.description : "";
    const line = path === "" ? description : `${path}: ${description}`;
    if (line.trim() !== "") out.push(line.slice(0, MAX_MESSAGE_LENGTH));
  }
  return out;
}

export class AdPlatformTestEventSender implements TestEventService {
  private readonly hasher: HashPort;

  constructor(private readonly deps: TestEventSenderDeps) {
    this.hasher = deps.hasher ?? new NodeHashPort();
  }

  async send(request: TestEventRequest): Promise<TestEventOutcome> {
    const { tenantId, platform } = request;
    const unsupported = NOT_SUPPORTED[platform];
    if (unsupported !== undefined) return failure("TEST_NOT_SUPPORTED", unsupported);
    if (!isTestable(platform)) {
      return failure("TEST_NOT_SUPPORTED", "Test events are not available for this platform.");
    }

    let live: readonly LiveConnection[];
    try {
      live = await this.deps.connections.listLive(tenantId);
    } catch {
      return failure("UNAVAILABLE", "Test events are unavailable right now. Try again later.");
    }
    const connection = live.find((candidate) => candidate.platform === platform);
    if (connection === undefined || connection.secret === null || connection.secret === "") {
      return failure(
        "NOT_CONNECTED",
        "This platform is not connected, or the connection is switched off. Save it with its token first.",
      );
    }

    const wantsCode = (CODE_PLATFORMS as readonly string[]).includes(platform);
    const testEventCode = wantsCode ? (request.testEventCode ?? connection.testEventCode) : null;
    if (wantsCode && (testEventCode === null || testEventCode === undefined)) {
      return failure("TEST_CODE_REQUIRED", CODE_REQUIRED[platform] ?? "Enter a test code first.");
    }

    const now = this.deps.clock.now();
    const sentAt = now.toISOString();
    const uuid = this.deps.newId();
    const testId = `test_${uuid}`;

    // The destination the real delivery uses (endpoint, builder, how the token is presented), with the two
    // test-only differences applied to a COPY: GA4 goes to the debug path and Meta/TikTok carry this request's code.
    const destination = destinationFor(connection, tenantId);
    const builderKey = destination.builderKey;
    if (builderKey === undefined) {
      return failure("TEST_NOT_SUPPORTED", "Test events are not available for this platform.");
    }
    const endpoint =
      platform === "ga4"
        ? {
            ...destination.endpoint,
            url: destination.endpoint.url.replace("/mp/collect", "/debug/mp/collect"),
          }
        : destination.endpoint;

    const payload = await this.payloadFor({
      tenantId,
      platform,
      builderKey,
      testId,
      uuid,
      now,
      targetId: destination.vendorTarget?.id ?? "",
      testEventCode: testEventCode ?? undefined,
    });
    if (!payload.ok) {
      this.log(platform, "blocked");
      return {
        ok: true,
        result: { platform, status: "rejected", messages: [payload.reason], sentAt },
      };
    }

    const adapter = new HttpJsonAdapter({
      http: this.deps.transport,
      credentials: {
        resolve: (ref) =>
          Promise.resolve(ref === endpoint.credentialRef ? connection.secret : null),
      },
      now: () => this.deps.clock.now().getTime(),
    });
    const response = await adapter.send({
      destination: destination.key,
      endpoint,
      payload: payload.payload,
      dedupId: testId,
      eventId: testId,
    });

    const base: Omit<TestEventResult, "status"> = {
      platform,
      ...(response.statusCode === undefined ? {} : { vendorStatus: response.statusCode }),
      sentAt,
    };

    let status: TestEventResult["status"] = response.ok ? "sent" : "rejected";
    let messages: readonly string[] | undefined;
    if (platform === "ga4" && response.ok) {
      messages = messagesOf(response.vendorResponse);
      if (messages.length > 0) status = "rejected";
    }
    // TikTok answers HTTP 200 with its own error code in the body.
    if (platform === "tiktok" && response.ok) {
      const code = response.vendorResponse?.code;
      if (typeof code === "number" && code !== 0) status = "rejected";
    }

    this.log(platform, status);
    return {
      ok: true,
      result: { ...base, status, ...(messages === undefined ? {} : { messages }) },
    };
  }

  private async payloadFor(input: {
    readonly tenantId: string;
    readonly platform: ServerPlatform;
    readonly builderKey: NonNullable<ReturnType<typeof destinationFor>["builderKey"]>;
    readonly testId: string;
    readonly uuid: string;
    readonly now: Date;
    readonly targetId: string;
    readonly testEventCode: string | undefined;
  }): Promise<
    | { readonly ok: true; readonly payload: Readonly<Record<string, unknown>> }
    | { readonly ok: false; readonly reason: string }
  > {
    let storeUrl: string | null = null;
    try {
      storeUrl = await this.deps.storeUrls.storeUrlOf(input.tenantId);
    } catch {
      storeUrl = null;
    }

    const sentAt = input.now.toISOString();
    // A business reference cannot hold `_`, so the mapper gets the bare uuid; the test id replaces the ids below.
    const built = purchaseEnvelope(syntheticOrder(input.uuid, sentAt), {
      tenantId: input.tenantId,
      storeUrl: storeUrl ?? FALLBACK_STORE_URL,
    });
    // Same hand-off ingest + delivery make: identity normalised, per-platform match keys hashed from the RAW block.
    const rawIdentity = built.context.identity;
    const normalized =
      rawIdentity === undefined
        ? undefined
        : normalizeIdentity(rawIdentity, {
            defaultCountryCode: callingCodeForCurrency(TEST_CURRENCY),
          });
    const keys =
      normalized === undefined
        ? {}
        : await platformMatchKeys(MATCH_PLATFORM_OF[input.builderKey], normalized, this.hasher);

    const envelope = {
      ...built,
      // The vendors' dedupe `event_id` and GA4 `transaction_id` are the test id, not `ord_<id>`.
      dedupId: input.testId,
      payload: { ...built.payload, orderId: input.testId, transactionId: input.testId },
      consent: applyConsentPolicy(undefined, "notice_only", input.now),
      eventTimestampMs: input.now.getTime(),
      receivedAt: sentAt,
      environment: "production",
      tenancy: { tenantId: input.tenantId },
    } as EnrichedEnvelope;

    return buildVendorPayload(
      input.builderKey,
      vendorEventInputFrom(envelope, keys, input.now.getTime()),
      {
        id: input.targetId,
        ...(input.testEventCode === undefined ? {} : { testEventCode: input.testEventCode }),
      },
    );
  }

  private log(platform: string, outcome: string): void {
    try {
      this.deps.logger?.info("ad platform test event sent", { platform, outcome });
    } catch {
      // a failing logger must not turn a delivered test event into a failure
    }
  }
}
