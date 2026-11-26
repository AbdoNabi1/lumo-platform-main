import { describe, expect, it, vi } from "vitest";
import type { EntitlementTelemetry } from "@platform/entitlement";
import {
  CompositeTelemetry,
  LoggingEntitlementTelemetry,
  type EntitlementSpanSink,
} from "./entitlement-telemetry";

type DecisionEvent = Parameters<EntitlementTelemetry["onDecision"]>[0];

function event(overrides: {
  decision?: Record<string, unknown>;
  request?: Record<string, unknown>;
  simulated?: boolean;
}): DecisionEvent {
  return {
    decision: {
      featureKey: "discounts.automatic",
      allowed: true,
      source: "plan",
      ...overrides.decision,
    },
    request: { tenant: "tenant-a", ...overrides.request },
    target: "api",
    latencyMs: 3,
    cacheHit: false,
    simulated: overrides.simulated ?? false,
  } as unknown as DecisionEvent;
}

const logger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe("LoggingEntitlementTelemetry", () => {
  it("records an enforce span and a debug log with the decision attributes", () => {
    const log = logger();
    const span: EntitlementSpanSink = { record: vi.fn() };
    new LoggingEntitlementTelemetry({ logger: log as never, span }).onDecision(
      event({
        decision: {
          policy: "deny",
          quota: { state: "exceeded" },
          decisionId: "d-1",
          allowed: false,
        },
        request: { correlationId: "corr-9" },
      }),
    );

    const attributes = {
      "entitlement.tenant": "tenant-a",
      "entitlement.feature": "discounts.automatic",
      "entitlement.allowed": false,
      "entitlement.source": "plan",
      "entitlement.policy": "deny",
      "entitlement.quota": "exceeded",
      "entitlement.target": "api",
      "entitlement.cache_hit": false,
      "entitlement.simulated": false,
      "entitlement.latency_ms": 3,
      "entitlement.decision_id": "d-1",
      "entitlement.correlation_id": "corr-9",
    };
    expect(span.record).toHaveBeenCalledWith({ name: "entitlement.enforce", attributes });
    expect(log.debug).toHaveBeenCalledWith("entitlement decision", attributes);
  });

  it("fills defaults for an absent policy, quota and decision id, and omits a missing correlation id", () => {
    const log = logger();
    new LoggingEntitlementTelemetry({ logger: log as never }).onDecision(event({}));

    const attributes = log.debug.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(attributes["entitlement.policy"]).toBe("allow");
    expect(attributes["entitlement.quota"]).toBe("none");
    expect(attributes["entitlement.decision_id"]).toBe("");
    expect(attributes).not.toHaveProperty("entitlement.correlation_id");
  });

  it("names a simulated decision's span entitlement.simulate", () => {
    const span: EntitlementSpanSink = { record: vi.fn() };
    new LoggingEntitlementTelemetry({ logger: logger() as never, span }).onDecision(
      event({ simulated: true }),
    );
    expect(span.record).toHaveBeenCalledWith(
      expect.objectContaining({ name: "entitlement.simulate" }),
    );
  });
});

describe("CompositeTelemetry", () => {
  it("fans each decision out to every sink", () => {
    const a = { onDecision: vi.fn() };
    const b = { onDecision: vi.fn() };
    const e = event({});
    new CompositeTelemetry([a, b]).onDecision(e);
    expect(a.onDecision).toHaveBeenCalledWith(e);
    expect(b.onDecision).toHaveBeenCalledWith(e);
  });

  it("keeps going when a sink throws, so telemetry never affects the verdict", () => {
    const failing = {
      onDecision: vi.fn(() => {
        throw new Error("exporter down");
      }),
    };
    const after = { onDecision: vi.fn() };
    expect(() => new CompositeTelemetry([failing, after]).onDecision(event({}))).not.toThrow();
    expect(after.onDecision).toHaveBeenCalledTimes(1);
  });
});
