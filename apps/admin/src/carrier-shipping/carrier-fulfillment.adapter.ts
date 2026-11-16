import type { FulfillmentController, FulfillmentOrder } from "@platform/fulfillment";
import type { ShippableOrder, ShipCode } from "./ports";

type Ready =
  | { ok: true; fulfillmentOrderId: string; status: string }
  | { ok: false; code: ShipCode; httpStatus: number };
type Response = Awaited<ReturnType<FulfillmentController["getByOrder"]>>;
function failure(response: Response): Ready {
  if (response.status === 404) return { ok: false, code: "ORDER_NOT_FOUND", httpStatus: 404 };
  const message = (response.body as { message?: string }).message ?? "";
  const prefix = /^([A-Z_]+):/.exec(message)?.[1];
  const code =
    prefix === "STOCK_NOT_RESERVED" || prefix === "SHIPMENT_IN_PROGRESS"
      ? prefix
      : "ORDER_NOT_SHIPPABLE";
  return { ok: false, code, httpStatus: 409 };
}
function successful(response: Response): boolean {
  return response.status >= 200 && response.status < 300;
}

export class CarrierFulfillmentAdapter {
  constructor(
    private readonly fulfillment: Pick<
      FulfillmentController,
      | "getByOrder"
      | "create"
      | "prepareForCarrier"
      | "attachCarrierShipment"
      | "detachCarrierShipment"
    >,
  ) {}

  async ensureReady(tenantId: string, order: ShippableOrder): Promise<Ready> {
    const current = await this.fulfillment.getByOrder({ tenantId, orderRef: order.orderId });
    let fulfillmentOrderId: string;
    if (current.status === 404) {
      const created = await this.fulfillment.create({
        tenantId,
        orderRef: order.orderId,
        items: order.items.map((item) => ({ productRef: item.productId, quantity: item.quantity })),
      });
      if (!successful(created)) return failure(created);
      fulfillmentOrderId = (created.body as { fulfillmentOrderId: string }).fulfillmentOrderId;
    } else {
      if (!successful(current)) return failure(current);
      const value = current.body as FulfillmentOrder;
      if (
        ![
          "created",
          "failed",
          "reservation_requested",
          "confirmed",
          "picking_started",
          "picking_completed",
          "packing_started",
          "packing_completed",
          "shipment_created",
          "tracking_assigned",
        ].includes(value.status.value)
      ) {
        return { ok: false, code: "ORDER_NOT_SHIPPABLE", httpStatus: 409 };
      }
      fulfillmentOrderId = value.id.toString();
    }
    const prepared = await this.fulfillment.prepareForCarrier({ tenantId, fulfillmentOrderId });
    if (!successful(prepared)) return failure(prepared);
    return { ok: true, fulfillmentOrderId, status: (prepared.body as { status: string }).status };
  }

  async attach(
    tenantId: string,
    fulfillmentOrderId: string,
    carrier: string,
    carrierShipmentId: string,
    trackingNumber: string,
  ): Promise<boolean> {
    const response = await this.fulfillment.attachCarrierShipment({
      tenantId,
      fulfillmentOrderId,
      carrier,
      carrierShipmentId,
      trackingNumber,
    });
    return successful(response);
  }
  async detach(tenantId: string, fulfillmentOrderId: string): Promise<boolean> {
    return successful(
      await this.fulfillment.detachCarrierShipment({ tenantId, fulfillmentOrderId }),
    );
  }
}
