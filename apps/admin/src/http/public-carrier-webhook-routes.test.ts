import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestContext } from "@platform/http";
import type { WiredAdmin } from "../composition";
import { publicCarrierWebhookRoutes, UNAUTHORIZED_BODY } from "./public-carrier-webhook-routes";

beforeEach(() => {
  expect.hasAssertions();
});

const webhook24 = {
  _id: "d1",
  trackingNumber: 48089608,
  state: 24,
  type: "SEND",
  timeStamp: 1689252908261,
  businessReference: "1001-1",
};
const raw = (o: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(o));
const ctx = (
  tenantId: string,
  headers: Record<string, string | undefined>,
  body: Uint8Array | undefined,
): RequestContext => ({
  tenantId,
  principal: { id: "public", kind: "customer", roles: [], tenantId },
  requestId: "r",
  correlationId: "r",
  ...(body === undefined ? {} : { rawBody: body }),
  headers,
});

const recorded = {
  shipmentId: "s-1",
  fulfillmentRef: "fo-1",
  status: "in_transit",
  duplicate: false,
  transitions: ["carrier_accepted", "in_transit"],
  carrier: "bosta",
  trackingNumber: "48089608",
  carrierDeliveryId: "d1",
  isCurrentShipment: true,
};

function fake(
  over: {
    verify?: ReturnType<typeof vi.fn>;
    record?: ReturnType<typeof vi.fn>;
    mirror?: ReturnType<typeof vi.fn>;
    logger?: { warn: ReturnType<typeof vi.fn> };
  } = {},
): WiredAdmin {
  return {
    carrierWebhooks: {
      verify: over.verify ?? vi.fn().mockResolvedValue(true),
      record: over.record ?? vi.fn().mockResolvedValue({ status: 200, body: recorded }),
      mirrorFulfillment: over.mirror ?? vi.fn().mockResolvedValue({ status: 200, body: {} }),
      ...(over.logger ? { logger: over.logger } : {}),
    },
  } as unknown as WiredAdmin;
}

async function call(admin: WiredAdmin, context: RequestContext) {
  const [route] = publicCarrierWebhookRoutes(admin);
  return route!.handle({ body: {}, params: {}, query: {}, context });
}

const good = (body: Uint8Array = raw(webhook24)) => ctx("t-1", { authorization: "s" }, body);

describe("public carrier webhook route", () => {
  it("is a public POST route under shipping:record_webhook", () => {
    const [route] = publicCarrierWebhookRoutes(fake());
    expect(route).toMatchObject({
      method: "POST",
      path: "/public/shipping/webhook/bosta",
      public: true,
      permission: "shipping:record_webhook",
    });
  });

  it("a wrong secret and a missing secret for a known tenant give the same 401 body (Review Focus 3)", async () => {
    const verify = vi.fn().mockResolvedValue(false);
    const admin = fake({ verify });
    const body = raw(webhook24);
    const a = await call(admin, ctx("t-1", { authorization: "wrong" }, body));
    const b = await call(admin, ctx("t-1", {}, body));
    expect(a).toEqual({ status: 401, body: UNAUTHORIZED_BODY });
    expect(b).toEqual(a);
    expect(verify).toHaveBeenCalledWith({
      tenantId: "t-1",
      carrierKey: "bosta",
      presented: "wrong",
    });
    expect(verify).toHaveBeenCalledWith({
      tenantId: "t-1",
      carrierKey: "bosta",
      presented: undefined,
    });
  });

  it("records state 24 as in_transit with a scan, and mirrors the fulfillment", async () => {
    const record = vi.fn().mockResolvedValue({ status: 200, body: recorded });
    const mirror = vi.fn().mockResolvedValue({ status: 200, body: {} });
    const res = await call(fake({ record, mirror }), good());
    expect(res).toEqual({ status: 200, body: { ok: true } });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "t-1",
        carrier: "bosta",
        trackingNumber: "48089608",
        eventId: "48089608:24:1689252908261",
        kind: "24",
        toStatus: "in_transit",
        scan: { description: "Received at warehouse", occurredAt: new Date(1689252908261) },
      }),
    );
    expect(mirror).toHaveBeenCalledWith({
      tenantId: "t-1",
      fulfillmentOrderId: "fo-1",
      shipmentStatus: "in_transit",
      carrier: "bosta",
      trackingNumber: "48089608",
      carrierShipmentId: "d1",
    });
  });

  it("omits trackingNumber and carrierShipmentId from the mirror when Task 8 has none", async () => {
    const mirror = vi.fn().mockResolvedValue({ status: 200, body: {} });
    const record = vi.fn().mockResolvedValue({
      status: 200,
      body: { ...recorded, trackingNumber: null, carrierDeliveryId: null },
    });
    await call(fake({ record, mirror }), good());
    expect(mirror).toHaveBeenCalledWith({
      tenantId: "t-1",
      fulfillmentOrderId: "fo-1",
      shipmentStatus: "in_transit",
      carrier: "bosta",
    });
  });

  it("a scan-only webhook (no transitions) still re-mirrors once", async () => {
    const mirror = vi.fn().mockResolvedValue({ status: 200, body: {} });
    const record = vi.fn().mockResolvedValue({
      status: 200,
      body: { ...recorded, transitions: [], duplicate: false },
    });
    const res = await call(fake({ record, mirror }), good());
    expect(res).toEqual({ status: 200, body: { ok: true } });
    expect(mirror).toHaveBeenCalledTimes(1);
  });

  it("an RTO return leg records the scan without a toStatus", async () => {
    const record = vi.fn().mockResolvedValue({ status: 200, body: recorded });
    await call(fake({ record }), good(raw({ ...webhook24, type: "RTO" })));
    const input = record.mock.calls[0]![0] as Record<string, unknown>;
    expect(input).not.toHaveProperty("toStatus");
    expect(input.scan).toEqual({
      description: "Received at warehouse",
      occurredAt: new Date(1689252908261),
    });
  });

  it("a tracking number this tenant doesn't own is ignored with 200 (lookup is tenant-scoped)", async () => {
    const mirror = vi.fn();
    const record = vi.fn().mockResolvedValue({ status: 404, body: { code: "NOT_FOUND" } });
    const res = await call(fake({ record, mirror }), good());
    expect(res).toEqual({ status: 200, body: { ignored: true } });
    expect(mirror).not.toHaveBeenCalled();
  });

  it("a duplicate answers 200 { duplicate: true } and never mirrors", async () => {
    const mirror = vi.fn();
    const record = vi
      .fn()
      .mockResolvedValue({ status: 200, body: { ...recorded, duplicate: true, transitions: [] } });
    const res = await call(fake({ record, mirror }), good());
    expect(res).toEqual({ status: 200, body: { duplicate: true } });
    expect(mirror).not.toHaveBeenCalled();
  });

  it("a predecessor shipment is recorded but never mirrored", async () => {
    const mirror = vi.fn();
    const record = vi
      .fn()
      .mockResolvedValue({ status: 200, body: { ...recorded, isCurrentShipment: false } });
    const res = await call(fake({ record, mirror }), good());
    expect(res).toEqual({ status: 200, body: { ok: true } });
    expect(mirror).not.toHaveBeenCalled();
  });

  it("over 16 KiB, or no raw body, is 413 before any secret check", async () => {
    const verify = vi.fn();
    const admin = fake({ verify });
    const big = await call(admin, good(new Uint8Array(16_385)));
    const none = await call(admin, ctx("t-1", { authorization: "s" }, undefined));
    expect(big).toEqual({ status: 413, body: { code: "PAYLOAD_TOO_LARGE" } });
    expect(none).toEqual(big);
    expect(verify).not.toHaveBeenCalled();
  });

  it("bad JSON from an authenticated sender is 422 VALIDATION and records nothing", async () => {
    const record = vi.fn();
    const res = await call(fake({ record }), good(new TextEncoder().encode("{nope")));
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "VALIDATION" });
    expect(record).not.toHaveBeenCalled();
  });

  it("a mirror failure is logged and still answers 200 (rejection and non-2xx)", async () => {
    const logger = { warn: vi.fn() };
    const expectedMeta = { tenantId: "t-1", shipmentId: "s-1", status: "in_transit" };
    const thrown = await call(
      fake({ mirror: vi.fn().mockRejectedValue(new Error("boom")), logger }),
      good(),
    );
    const non2xx = await call(
      fake({ mirror: vi.fn().mockResolvedValue({ status: 500, body: {} }), logger }),
      good(),
    );
    expect(thrown).toEqual({ status: 200, body: { ok: true } });
    expect(non2xx).toEqual(thrown);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenNthCalledWith(
      1,
      "carrier webhook: fulfillment mirror failed",
      expectedMeta,
    );
    expect(logger.warn).toHaveBeenNthCalledWith(
      2,
      "carrier webhook: fulfillment mirror failed",
      expectedMeta,
    );
  });

  it("a mirror failure without a logger still answers 200", async () => {
    const res = await call(fake({ mirror: vi.fn().mockRejectedValue(new Error("x")) }), good());
    expect(res).toEqual({ status: 200, body: { ok: true } });
  });

  it("the response body never contains the payload", async () => {
    const outcomes = [
      await call(fake(), good()),
      await call(
        fake({
          record: vi
            .fn()
            .mockResolvedValue({ status: 200, body: { ...recorded, duplicate: true } }),
        }),
        good(),
      ),
      await call(fake({ record: vi.fn().mockResolvedValue({ status: 404, body: {} }) }), good()),
    ];
    for (const res of outcomes) {
      const text = JSON.stringify(res.body);
      expect(text).not.toContain("48089608");
      expect(text).not.toContain("SEND");
    }
  });

  it("falls back to the receive time when the webhook has no timeStamp", async () => {
    const record = vi.fn().mockResolvedValue({ status: 200, body: recorded });
    const { timeStamp: _omit, ...noStamp } = webhook24;
    await call(fake({ record }), good(raw(noStamp)));
    const input = record.mock.calls[0]![0] as { scan: { occurredAt: Date } };
    expect(input.scan.occurredAt).toBeInstanceOf(Date);
  });

  it("passes an exception reason to record as reason", async () => {
    const record = vi.fn().mockResolvedValue({ status: 200, body: recorded });
    await call(
      fake({ record }),
      good(raw({ ...webhook24, state: 47, exceptionReason: "Customer unreachable" })),
    );
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "47", reason: "Customer unreachable" }),
    );
  });
});
