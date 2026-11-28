import { describe, expect, it } from "vitest";
import { Expr } from "@platform/expression";
import type { RuleSet } from "@platform/rules";

import { BOT_SKIP_THRESHOLD } from "../enrichment/bot-score";
import { isBusinessConversion } from "../enrichment/business-conversion";
import type { EnrichedEnvelope } from "../envelope/envelope";
import type { DestinationDefinition, DestinationKey, DestinationRegistryPort } from "./destination";
import { route } from "./router";

const NOW = "2026-07-19T12:00:00.000Z";

function envelope(
  name: string,
  botScore: number | undefined,
  extra: Partial<EnrichedEnvelope> = {},
): EnrichedEnvelope {
  return {
    eventId: "01919d1e-0000-7000-8000-000000000001",
    eventName: name,
    eventVersion: 1,
    dedupId: "dedup-1",
    timestamp: NOW,
    receivedAt: NOW,
    eventTimestampMs: Date.parse(NOW),
    source: "web",
    eventOrigin: "browser",
    environment: "production",
    consent: {
      analytics: true,
      marketing: true,
      personalization: true,
      grants: { ad_storage: true, ad_user_data: true, analytics_storage: true },
    },
    context: {
      technical: botScore === undefined ? {} : { botScore },
    },
    properties: {},
    tenancy: { tenantId: "t-1" },
    ...extra,
  } as EnrichedEnvelope;
}

const destination: DestinationDefinition = {
  key: "meta.capi",
  platform: "meta",
  transport: "http_json",
  channel: "server",
  consentPurpose: "marketing",
  mappingProfileKey: "meta.capi.mapping",
  endpoint: { url: "https://vendor.test/events", method: "POST", timeoutMs: 5_000 },
  retry: { maxAttempts: 3, baseDelayMs: 10, factor: 2, maxDelayMs: 100 },
  enabled: true,
};

const registry: DestinationRegistryPort = {
  resolve: (key) => (key === destination.key ? destination : null),
  resolveVersion: (key) => (key === destination.key ? destination : null),
  listActive: () => [destination],
};

const ruleSet: RuleSet<DestinationKey> = {
  id: "routing",
  version: 1,
  mode: "all_matches",
  rules: [
    { id: "all", priority: 1, when: Expr.where("event.version", "gt", 0), then: "meta.capi" },
  ],
};

const decide = (event: EnrichedEnvelope) =>
  route({ envelope: event, ruleSet, destinations: registry });

describe("bot score at routing (P1-D8)", () => {
  it("a page view at or above the threshold is excluded with the visible reason `bot`", () => {
    for (const score of [BOT_SKIP_THRESHOLD, 70, 100]) {
      const decision = decide(envelope("page_viewed", score));
      expect(decision.routed).toHaveLength(0);
      expect(decision.excluded).toEqual([{ key: "meta.capi", reason: { code: "bot", score } }]);
    }
  });

  it("a page view just below the threshold, or never scored, is routed", () => {
    expect(decide(envelope("page_viewed", BOT_SKIP_THRESHOLD - 1)).routed).toHaveLength(1);
    expect(decide(envelope("page_viewed", 0)).routed).toHaveLength(1);
    // Not scored is not "human" and not "bot": the event goes through as before.
    expect(decide(envelope("page_viewed", undefined)).routed).toHaveLength(1);
  });

  it("a real order is never dropped, whatever the score", () => {
    const order = decide(envelope("purchase", 100, { payload: { orderId: "o-1" } }));
    expect(order.routed).toHaveLength(1);
    expect(order.excluded).toHaveLength(0);
  });

  it("a real lead is never dropped, whatever the score", () => {
    expect(decide(envelope("form_submitted", 100)).routed).toHaveLength(1);
    expect(decide(envelope("lead_created", 100, { dedupId: "lead_abc" })).routed).toHaveLength(1);
  });

  it("delivery and cancellation of an order are business events too", () => {
    expect(decide(envelope("order_delivered", 100)).routed).toHaveLength(1);
    expect(decide(envelope("order_cancelled", 100)).routed).toHaveLength(1);
  });

  it("a server-side emitter and an event naming an order are business events", () => {
    expect(decide(envelope("custom_thing", 100, { eventOrigin: "server" })).routed).toHaveLength(1);
    expect(
      decide(envelope("custom_thing", 100, { payload: { transactionId: "tx-9" } })).routed,
    ).toHaveLength(1);
  });

  it("other browser events of a bot are skipped (add to cart, view content, search)", () => {
    for (const name of ["add_to_cart", "product_viewed", "search", "visitor_touch"]) {
      expect(decide(envelope(name, 90)).routed).toHaveLength(0);
    }
  });
});

describe("isBusinessConversion", () => {
  it("is false for a plain browser page view", () => {
    expect(
      isBusinessConversion({ eventName: "page_viewed", eventOrigin: "browser", payload: {} }),
    ).toBe(false);
    expect(isBusinessConversion({ eventName: "page_viewed" })).toBe(false);
  });

  it("ignores blank order references", () => {
    expect(isBusinessConversion({ eventName: "page_viewed", payload: { orderId: "  " } })).toBe(
      false,
    );
  });
});
