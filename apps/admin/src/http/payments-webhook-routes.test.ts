import { describe, expect, it, vi } from "vitest";
import type { RequestContext } from "@platform/http";
import { paymentsWebhookRoutes } from "./payments-webhook-routes";
import type { WiredAdmin } from "../composition";

/**
 * C2-2/C2-6: proves the route actually CALLS `verifyWebhook` (which had zero call sites
 * repository-wide before C2-2) with the RAW request bytes + the `Stripe-Signature` header — not a
 * re-serialized approximation of the parsed body — and gates `recordWebhook` on its result.
 * Exercises `RouteDefinition.handle` directly with a spied `paymentsWebhook` seam, so no real PSP
 * is involved (nothing here builds or requires one).
 */

const rawBody = new TextEncoder().encode(
  JSON.stringify({
    id: "evt-1",
    type: "payment_intent.canceled",
    data: { object: { id: "pi-1" } },
  }),
);

function contextWith(headers: Record<string, string | undefined>): RequestContext {
  return {
    tenantId: "t-1",
    principal: { id: "public", kind: "customer", roles: [] },
    requestId: "req-1",
    correlationId: "req-1",
    rawBody,
    headers,
  };
}

function fakeAdmin(
  verifyWebhook: ReturnType<typeof vi.fn>,
  recordWebhook: ReturnType<typeof vi.fn>,
): WiredAdmin {
  // Deliberately partial fixture (only `paymentsWebhook`) — needs the `unknown` hop since it has
  // no structural overlap with the full `WiredAdmin` composition root type.
  return { paymentsWebhook: { verifyWebhook, recordWebhook } } as unknown as WiredAdmin;
}

const body = {
  id: "evt-1",
  type: "payment_intent.canceled",
  data: { object: { id: "pi-1" } },
};

describe("payments webhook route (C2-2/C2-6)", () => {
  it("calls verifyWebhook with the RAW body + Stripe-Signature header BEFORE recording, and records on success", async () => {
    const verifyWebhook = vi.fn().mockResolvedValue(true);
    const recordWebhook = vi.fn().mockResolvedValue({
      status: 200,
      body: { paymentIntentId: "pi-1", status: "cancelled", duplicate: false },
    });
    const [route] = paymentsWebhookRoutes(fakeAdmin(verifyWebhook, recordWebhook));

    const res = await route!.handle({
      body,
      params: {},
      query: {},
      context: contextWith({ "stripe-signature": "t=1,v1=sig-abc" }),
    });

    expect(verifyWebhook).toHaveBeenCalledTimes(1);
    const [payloadArg, signatureArg] = verifyWebhook.mock.calls[0]!;
    expect(signatureArg).toBe("t=1,v1=sig-abc");
    expect(payloadArg).toBe(rawBody); // the EXACT raw bytes, not a reconstruction

    expect(recordWebhook).toHaveBeenCalledWith({
      paymentIntentId: "pi-1",
      provider: "stripe",
      eventId: "evt-1",
      kind: "cancelled", // mapped from Stripe's `payment_intent.canceled`
    });
    expect(res.status).toBe(200);
  });

  it("rejects with 401 and NEVER calls recordWebhook when verifyWebhook returns false", async () => {
    const verifyWebhook = vi.fn().mockResolvedValue(false);
    const recordWebhook = vi.fn();
    const [route] = paymentsWebhookRoutes(fakeAdmin(verifyWebhook, recordWebhook));

    const res = await route!.handle({
      body,
      params: {},
      query: {},
      context: contextWith({ "stripe-signature": "t=1,v1=bad-sig" }),
    });

    expect(res.status).toBe(401);
    expect(recordWebhook).not.toHaveBeenCalled();
  });

  it("rejects with 401 and never calls verifyWebhook when the Stripe-Signature header is missing", async () => {
    const verifyWebhook = vi.fn();
    const recordWebhook = vi.fn();
    const [route] = paymentsWebhookRoutes(fakeAdmin(verifyWebhook, recordWebhook));

    const res = await route!.handle({ body, params: {}, query: {}, context: contextWith({}) });

    expect(res.status).toBe(401);
    expect(verifyWebhook).not.toHaveBeenCalled();
    expect(recordWebhook).not.toHaveBeenCalled();
  });

  it("maps an unrecognized Stripe event type through verbatim (still recorded, no forced transition)", async () => {
    const verifyWebhook = vi.fn().mockResolvedValue(true);
    const recordWebhook = vi.fn().mockResolvedValue({ status: 200, body: {} });
    const [route] = paymentsWebhookRoutes(fakeAdmin(verifyWebhook, recordWebhook));

    await route!.handle({
      body: { id: "evt-2", type: "charge.refunded", data: { object: { id: "pi-1" } } },
      params: {},
      query: {},
      context: contextWith({ "stripe-signature": "t=1,v1=sig" }),
    });

    expect(recordWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "charge.refunded" }),
    );
  });

  it("is declared public — a PSP webhook carries no admin Bearer token to check", () => {
    const [route] = paymentsWebhookRoutes(fakeAdmin(vi.fn(), vi.fn()));
    expect(route!.public).toBe(true);
  });
});
