import type { DistributedLock } from "@platform/contracts";
import type { Shipment, ShippingController } from "@platform/shipping";
import { logger } from "@platform/utils";
import { decideCodAmount } from "./cod-amount";
import type { CarrierFulfillmentAdapter } from "./carrier-fulfillment.adapter";
import type { CarrierOrderReader, ShipOutcome } from "./ports";

export const SHIP_LOCK_TTL_MS = 60_000;
export interface ShipOrderWithCarrierInput {
  readonly tenantId: string;
  readonly orderId: string;
  readonly carrierKey: string;
  readonly idempotencyKey: string;
}
type Shipping = Pick<
  ShippingController,
  "getByFulfillment" | "create" | "advance" | "createLabel" | "countByFulfillment"
>;
type Response = Awaited<ReturnType<ShippingController["getByFulfillment"]>>;
function responseFailure(response: Response, orderNumber: string): ShipOutcome {
  const body = response.body as { code?: string; reason?: string };
  return {
    ok: false,
    code: body?.code ?? "ORDER_NOT_SHIPPABLE",
    httpStatus: response.status,
    ...(body?.reason ? { reason: body.reason } : {}),
    orderNumber,
  };
}
export class ShipOrderWithCarrier {
  constructor(
    private readonly deps: {
      orders: CarrierOrderReader;
      fulfillment: CarrierFulfillmentAdapter;
      shipping: Shipping;
      lock?: DistributedLock;
    },
  ) {}
  async execute(input: ShipOrderWithCarrierInput): Promise<ShipOutcome> {
    const lock =
      this.deps.lock === undefined
        ? undefined
        : await this.deps.lock.acquire(
            `carrier-ship:${input.tenantId}:${input.orderId}`,
            SHIP_LOCK_TTL_MS,
          );
    if (lock === null) return { ok: false, code: "SHIPMENT_IN_PROGRESS", httpStatus: 409 };
    try {
      return await this.ship(input);
    } finally {
      try {
        await lock?.release();
      } catch {
        logger.warn("carrier ship lock release failed", {
          tenantId: input.tenantId,
          orderId: input.orderId,
        });
      }
    }
  }
  private async ship(input: ShipOrderWithCarrierInput): Promise<ShipOutcome> {
    const { tenantId, orderId, carrierKey } = input;
    const order = await this.deps.orders.read(tenantId, orderId);
    if (order === null) return { ok: false, code: "ORDER_NOT_FOUND", httpStatus: 404 };
    const fail = (code: string, httpStatus = 409): ShipOutcome => ({
      ok: false,
      code,
      httpStatus,
      orderNumber: order.orderNumber,
    });
    if (!order.open) return fail("ORDER_NOT_SHIPPABLE");
    const intent =
      order.paymentStatus !== "paid" && order.paymentRef
        ? await this.deps.orders.codIntent(tenantId, order.paymentRef)
        : null;
    const cod = decideCodAmount(order, intent);
    if (!cod.ok) return fail(cod.code);
    const ready = await this.deps.fulfillment.ensureReady(tenantId, order);
    if (!ready.ok) return { ...ready, orderNumber: order.orderNumber };
    const fulfillmentRef = ready.fulfillmentOrderId;
    const current = await this.deps.shipping.getByFulfillment({ tenantId, fulfillmentRef });
    if (current.status !== 200 && current.status !== 404)
      return responseFailure(current, order.orderNumber);
    const currentShipment = current.status === 200 ? (current.body as Shipment) : undefined;
    if (
      ready.trackingNumber !== undefined &&
      (currentShipment === undefined ||
        ["voided", "cancelled"].includes(currentShipment.status.value) ||
        currentShipment.trackingNumber?.value !== ready.trackingNumber)
    ) {
      try {
        if (!(await this.deps.fulfillment.detach(tenantId, fulfillmentRef, ready.trackingNumber)))
          return fail("FULFILLMENT_DETACH_PENDING");
      } catch {
        return fail("FULFILLMENT_DETACH_PENDING");
      }
    }
    let shipmentId: string;
    let status: string;
    if (
      current.status === 404 ||
      (current.status === 200 &&
        ["cancelled", "closed"].includes((current.body as Shipment).status.value))
    ) {
      const created = await this.deps.shipping.create({
        tenantId,
        fulfillmentRef,
        packages: [
          {
            reference: order.orderNumber,
            itemRefs: order.items.map((item) => item.productId),
            weightGrams: 1,
          },
        ],
      });
      if (created.status !== 201) return responseFailure(created, order.orderNumber);
      ({ shipmentId, status } = created.body as { shipmentId: string; status: string });
    } else {
      if (current.status !== 200) return responseFailure(current, order.orderNumber);
      const shipment = current.body as Shipment;
      shipmentId = shipment.id.toString();
      status = shipment.status.value;
    }
    if (status === "exception") return fail("SHIPMENT_NEEDS_REVIEW");
    if (!["created", "voided", "label_created"].includes(status))
      return fail("ORDER_NOT_SHIPPABLE");
    if (status === "voided") {
      const advanced = await this.deps.shipping.advance({
        tenantId,
        shipmentId,
        toStatus: "created",
      });
      if (advanced.status !== 200) return responseFailure(advanced, order.orderNumber);
    }
    const counted = await this.deps.shipping.countByFulfillment({ tenantId, fulfillmentRef });
    if (counted.status !== 200) return responseFailure(counted, order.orderNumber);
    const k = (counted.body as { count: number }).count - 1;
    if (k < 0) return fail("ORDER_NOT_SHIPPABLE");
    const reference = k === 0 ? order.orderNumber : `${order.orderNumber}-r${k}`;
    const { recipientName, phone, ...address } = order.shippingAddress;
    const labelled = await this.deps.shipping.createLabel({
      tenantId,
      shipmentId,
      carrier: {
        carrierKey,
        reference,
        recipient: { name: recipientName ?? "", phone: phone ?? "" },
        address,
        codAmountMinor: cod.codAmountMinor,
        currency: order.currency,
        itemsCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
        description: order.items
          .map(
            (item) =>
              `${item.name}${item.variantTitle ? ` (${item.variantTitle})` : ""} ×${item.quantity}`,
          )
          .join("، "),
        packageImages: order.items.flatMap((item) =>
          item.imageUrl?.startsWith("https://") ? [item.imageUrl] : [],
        ),
      },
    });
    if (labelled.status !== 200) return responseFailure(labelled, order.orderNumber);
    const result = labelled.body as {
      carrierKey?: string;
      carrierDeliveryId?: string;
      trackingNumber?: string;
    };
    if (!result.carrierKey || !result.carrierDeliveryId || !result.trackingNumber)
      return fail("SHIPMENT_NEEDS_REVIEW");
    try {
      if (
        !(await this.deps.fulfillment.attach(
          tenantId,
          fulfillmentRef,
          result.carrierKey,
          result.carrierDeliveryId,
          result.trackingNumber,
        ))
      )
        logger.warn("carrier fulfillment attach failed", {
          tenantId,
          fulfillmentOrderId: fulfillmentRef,
          shipmentId,
        });
    } catch {
      logger.warn("carrier fulfillment attach failed", {
        tenantId,
        fulfillmentOrderId: fulfillmentRef,
        shipmentId,
      });
    }
    return {
      ok: true,
      value: {
        orderId,
        orderNumber: order.orderNumber,
        shipmentId,
        trackingNumber: result.trackingNumber,
        carrierKey: result.carrierKey,
      },
    };
  }
}
