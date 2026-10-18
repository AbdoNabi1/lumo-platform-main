import { describe, expect, it } from "vitest";
import {
  MissingEnvelopeTenantError,
  readEnvelopeTenant,
  requireEnvelopeTenant,
  type IntegrationEvent,
} from "./integration-event";

describe("IntegrationEvent.tenantId (G-64)", () => {
  it("is required on the type — an envelope without it does not compile", () => {
    const base = {
      messageId: "m",
      type: "orders.order.placed",
      eventVersion: 1,
      aggregateId: "a",
      aggregateType: "order",
      occurredAt: "2026-09-26T00:00:00.000Z",
      correlationId: "c",
      causationId: "c",
      payload: {},
      metadata: {},
    };
    // @ts-expect-error tenantId is required: the wire contract carries the tenant on every message
    const untenanted: IntegrationEvent<object> = base;
    expect(untenanted).toBeDefined();
  });
});

describe("readEnvelopeTenant", () => {
  it("returns the tenant the envelope carries, untouched", () => {
    expect(readEnvelopeTenant({ tenantId: "tenant-a" })).toBe("tenant-a");
  });

  it.each([
    ["absent", {}],
    ["undefined", { tenantId: undefined }],
    ["empty", { tenantId: "" }],
    ["blank", { tenantId: "   " }],
    ["null off the wire", { tenantId: null }],
    ["a number off the wire", { tenantId: 7 }],
  ])("returns null when the tenant is %s — the caller decides which way to fail", (_n, event) => {
    expect(readEnvelopeTenant(event)).toBeNull();
  });
});

describe("requireEnvelopeTenant", () => {
  const message = { type: "billing.invoice.paid", messageId: "msg-42" };

  it("returns the tenant when the envelope carries one", () => {
    expect(requireEnvelopeTenant({ ...message, tenantId: "tenant-b" }, "LedgerConsumer")).toBe(
      "tenant-b",
    );
  });

  it.each([
    ["absent", {}],
    ["blank", { tenantId: "  " }],
    ["not a string", { tenantId: 7 }],
  ])("throws MissingEnvelopeTenantError when the tenant is %s — never a default", (_n, tenant) => {
    expect(() => requireEnvelopeTenant({ ...message, ...tenant }, "LedgerConsumer")).toThrow(
      MissingEnvelopeTenantError,
    );
  });

  it("names the consumer, event type and message id so the DLQ entry is actionable", () => {
    let caught: unknown;
    try {
      requireEnvelopeTenant({ ...message, tenantId: "" }, "LedgerConsumer");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).toBeInstanceOf(MissingEnvelopeTenantError);
    const error = caught as MissingEnvelopeTenantError;
    expect(error.name).toBe("MissingEnvelopeTenantError");
    expect(error.message).toBe(
      'LedgerConsumer: "billing.invoice.paid" message msg-42 carries no tenantId on its envelope — ' +
        "refusing to guess one (G-64)",
    );
  });
});
