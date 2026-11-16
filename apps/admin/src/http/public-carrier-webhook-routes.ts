import { z } from "zod";
import { defineRoute, type RouteDefinition } from "@platform/http";
import {
  BOSTA_WEBHOOK_MAX_BYTES,
  bostaScanText,
  bostaWebhookEventId,
  mapBostaState,
  parseBostaWebhook,
} from "@platform/carrier-bosta";
import type { WiredAdmin } from "../composition";

/** The one 401 body: a wrong secret, a missing header and an unknown tenant are indistinguishable (Ruling 21). */
export const UNAUTHORIZED_BODY = { code: "UNAUTHORIZED", message: "Unauthorized" } as const;

/** Validation of the raw bytes is this route's own job (it needs them unparsed), so the schema only requires JSON. */
const anyBody = z.object({}).passthrough();

interface RecordedWebhook {
  readonly shipmentId: string;
  readonly fulfillmentRef: string;
  readonly status: string;
  readonly duplicate: boolean;
  readonly carrier: string;
  readonly trackingNumber: string | null;
  readonly carrierDeliveryId: string | null;
  readonly isCurrentShipment: boolean;
}

/**
 * Bosta's status webhook (spec 9a.1, Rulings 21-25). Public: Bosta presents no Bearer token, so the
 * authentication IS the per-tenant secret in the `Authorization` header, checked by `verify` before
 * the body is parsed. The response never echoes the payload.
 */
export function publicCarrierWebhookRoutes(admin: WiredAdmin): readonly RouteDefinition[] {
  const { verify, record, mirrorFulfillment, logger } = admin.carrierWebhooks;
  return [
    defineRoute({
      method: "POST",
      path: "/public/shipping/webhook/bosta",
      version: 1,
      permission: "shipping:record_webhook",
      public: true,
      summary: "Bosta delivery-status webhook (authenticated by the tenant's webhook secret)",
      schema: { body: anyBody },
      handle: async ({ context }) => {
        const rawBody = context.rawBody;
        if (rawBody === undefined || rawBody.byteLength > BOSTA_WEBHOOK_MAX_BYTES) {
          return { status: 413, body: { code: "PAYLOAD_TOO_LARGE" } };
        }
        const authorized = await verify({
          tenantId: context.tenantId,
          carrierKey: "bosta",
          presented: firstHeader(context.headers?.["authorization"]),
        });
        if (!authorized) return { status: 401, body: UNAUTHORIZED_BODY };

        const webhook = parseBostaWebhook(rawBody);
        if (webhook === null) {
          return { status: 422, body: { code: "VALIDATION", message: "Not a Bosta webhook" } };
        }
        const { target } = mapBostaState(webhook.state, webhook.type);
        const recorded = await record({
          tenantId: context.tenantId,
          carrier: "bosta",
          trackingNumber: webhook.trackingNumber,
          eventId: bostaWebhookEventId(webhook),
          kind: String(webhook.state),
          ...(target ? { toStatus: target } : {}),
          scan: {
            description: bostaScanText(webhook.state, webhook.type, webhook.exceptionReason),
            occurredAt:
              webhook.timeStamp !== undefined && Number.isFinite(webhook.timeStamp)
                ? new Date(webhook.timeStamp)
                : new Date(),
          },
          ...(webhook.exceptionReason === undefined ? {} : { reason: webhook.exceptionReason }),
        });
        // Not this tenant's shipment: answer 200 so Bosta stops retrying (Ruling 21).
        if (recorded.status === 404) return { status: 200, body: { ignored: true } };
        if (recorded.status !== 200) return recorded;

        const out = recorded.body as RecordedWebhook;
        if (out.duplicate) return { status: 200, body: { duplicate: true } };
        // Only the newest shipment of a fulfillment drives it (plan review 1, finding 7).
        if (out.isCurrentShipment) {
          await mirror(context.tenantId, out);
        }
        return { status: 200, body: { ok: true } };
      },
    }),
  ] as readonly RouteDefinition[];

  /** Ruling 25: best-effort. A failure is logged with ids only; the next webhook re-mirrors. */
  async function mirror(tenantId: string, out: RecordedWebhook): Promise<void> {
    let failed = false;
    try {
      const result = await mirrorFulfillment({
        tenantId,
        fulfillmentOrderId: out.fulfillmentRef,
        shipmentStatus: out.status,
        carrier: out.carrier,
        ...(out.trackingNumber ? { trackingNumber: out.trackingNumber } : {}),
        ...(out.carrierDeliveryId ? { carrierShipmentId: out.carrierDeliveryId } : {}),
      });
      failed = result.status < 200 || result.status >= 300;
    } catch {
      failed = true;
    }
    if (failed) {
      logger?.warn("carrier webhook: fulfillment mirror failed", {
        tenantId,
        shipmentId: out.shipmentId,
        status: out.status,
      });
    }
  }
}

function firstHeader(value: string | readonly string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (value === undefined) return undefined;
  return value[0];
}
