import type { Principal } from "@platform/contracts";
import type { FulfillmentController, FulfillmentOrder } from "@platform/fulfillment";
import type { Shipment, ShippingController } from "@platform/shipping";
import { logger } from "@platform/utils";
import { shipInBulk } from "../carrier-shipping/bulk-ship";
import type { CarrierFulfillmentAdapter } from "../carrier-shipping/carrier-fulfillment.adapter";
import type { CarrierOrderReader } from "../carrier-shipping/ports";
import type {
  ShipOrderWithCarrier,
  ShipOrderWithCarrierInput,
} from "../carrier-shipping/ship-order-with-carrier";
import { toShipmentDetailDto } from "../http/shipping-routes";
import type { AdminGuard } from "./admin-guard";
import type { AdminResponse } from "./admin-response";

type Selection = {
  tenantId: string;
  shipmentIds?: readonly string[];
  orderIds?: readonly string[];
  format?: "A4" | "A6";
  lang?: "ar" | "en";
};
export class CarrierShippingAdminController {
  constructor(
    private readonly deps: {
      guard: AdminGuard;
      orders: CarrierOrderReader;
      rawFulfillment: Pick<FulfillmentController, "getByOrder">;
      fulfillment: CarrierFulfillmentAdapter;
      shipping: Pick<
        ShippingController,
        | "getByFulfillment"
        | "getShipment"
        | "cancelCarrierShipment"
        | "printCarrierAwbs"
        | "listEnabledCarriers"
      >;
      shipper: ShipOrderWithCarrier;
    },
  ) {}
  private async checkShip(principal: Principal): Promise<AdminResponse | undefined> {
    return (
      (await this.deps.guard.ensure(principal, "shipping:create")) ??
      (await this.deps.guard.ensure(principal, "shipping:create_label")) ??
      undefined
    );
  }
  async ship(principal: Principal, input: ShipOrderWithCarrierInput): Promise<AdminResponse> {
    const denied = await this.checkShip(principal);
    if (denied) return denied;
    const outcome = await this.deps.shipper.execute(input);
    return outcome.ok
      ? { status: 200, body: outcome.value }
      : {
          status: outcome.httpStatus,
          body: {
            code: outcome.code,
            message: outcome.code,
            ...(outcome.reason ? { reason: outcome.reason } : {}),
          },
        };
  }
  async shipMany(
    principal: Principal,
    input: {
      tenantId: string;
      orderIds: readonly string[];
      carrierKey: string;
      idempotencyKey: string;
    },
  ): Promise<AdminResponse> {
    const denied = await this.checkShip(principal);
    if (denied) return denied;
    return {
      status: 200,
      body: await shipInBulk(
        (orderId, idempotencyKey) =>
          this.deps.shipper.execute({
            tenantId: input.tenantId,
            orderId,
            carrierKey: input.carrierKey,
            idempotencyKey,
          }),
        input,
        () => Date.now(),
      ),
    };
  }
  async cancel(
    principal: Principal,
    input: { tenantId: string; shipmentId: string },
  ): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "shipping:void_label");
    if (denied) return denied;
    const response = await this.deps.shipping.cancelCarrierShipment(input);
    if (response.status !== 200) return response;
    const result = response.body as {
      fulfillmentRef: string;
      shipmentId: string;
      status: string;
      trackingNumber?: string;
    };
    try {
      if (
        !result.trackingNumber ||
        !(await this.deps.fulfillment.detach(
          input.tenantId,
          result.fulfillmentRef,
          result.trackingNumber,
        ))
      )
        logger.warn("carrier fulfillment detach failed", {
          tenantId: input.tenantId,
          fulfillmentOrderId: result.fulfillmentRef,
          shipmentId: input.shipmentId,
        });
    } catch {
      logger.warn("carrier fulfillment detach failed", {
        tenantId: input.tenantId,
        fulfillmentOrderId: result.fulfillmentRef,
        shipmentId: input.shipmentId,
      });
    }
    return { status: 200, body: { shipmentId: result.shipmentId, status: result.status } };
  }
  async printAwbs(principal: Principal, input: Selection): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "shipping:read");
    if (denied) return denied;
    const shipmentIds = [...(input.shipmentIds ?? [])];
    const missing: string[] = [];
    for (const orderId of input.orderIds ?? []) {
      const order = await this.deps.orders.read(input.tenantId, orderId);
      if (order === null)
        return { status: 404, body: { code: "ORDER_NOT_FOUND", message: "Order not found" } };
      const fulfillment = await this.deps.rawFulfillment.getByOrder({
        tenantId: input.tenantId,
        orderRef: orderId,
      });
      if (fulfillment.status !== 200) {
        if (fulfillment.status !== 404) return fulfillment;
        missing.push(order.orderNumber);
        continue;
      }
      const fulfillmentRef = (fulfillment.body as FulfillmentOrder).id.toString();
      const response = await this.deps.shipping.getByFulfillment({
        tenantId: input.tenantId,
        fulfillmentRef,
      });
      if (response.status !== 200) {
        if (response.status !== 404) return response;
        missing.push(order.orderNumber);
        continue;
      }
      const shipment = response.body as Shipment;
      if (
        ["created", "voided", "cancelled"].includes(shipment.status.value) ||
        !shipment.label ||
        !shipment.carrier ||
        !shipment.trackingNumber
      )
        missing.push(order.orderNumber);
      else shipmentIds.push(shipment.id.toString());
    }
    if (missing.length)
      return {
        status: 409,
        body: {
          code: "AWB_NOT_AVAILABLE",
          message: "Waybill is unavailable",
          orderNumbers: missing,
        },
      };
    const response = await this.deps.shipping.printCarrierAwbs({
      tenantId: input.tenantId,
      shipmentIds,
      ...(input.format ? { format: input.format } : {}),
      ...(input.lang ? { lang: input.lang } : {}),
    });
    if (response.status !== 200) {
      const body = response.body as { code?: string };
      return body.code === "AWB_NOT_AVAILABLE"
        ? { ...response, body: { ...body, orderNumbers: [] } }
        : response;
    }
    return {
      status: 200,
      body: Buffer.from((response.body as { pdf: Uint8Array }).pdf),
      headers: {
        "content-type": "application/pdf",
        "cache-control": "private, no-store",
        "content-disposition": 'inline; filename="waybills.pdf"',
      },
    };
  }
  async orderCarrierShipment(
    principal: Principal,
    input: { tenantId: string; orderId: string },
  ): Promise<AdminResponse> {
    const denied = await this.deps.guard.ensure(principal, "shipping:read");
    if (denied) return denied;
    const order = await this.deps.orders.read(input.tenantId, input.orderId);
    if (order === null)
      return { status: 404, body: { code: "ORDER_NOT_FOUND", message: "Order not found" } };
    const carriers = await this.deps.shipping.listEnabledCarriers({ tenantId: input.tenantId });
    if (carriers.status !== 200) return carriers;
    const fulfillment = await this.deps.rawFulfillment.getByOrder({
      tenantId: input.tenantId,
      orderRef: input.orderId,
    });
    if (fulfillment.status === 404)
      return {
        status: 200,
        body: {
          fulfillmentOrderId: null,
          shipment: null,
          carriers: (carriers.body as { carriers: unknown }).carriers,
        },
      };
    if (fulfillment.status !== 200) return fulfillment;
    const fulfillmentOrderId = (fulfillment.body as FulfillmentOrder).id.toString();
    const shipment = await this.deps.shipping.getByFulfillment({
      tenantId: input.tenantId,
      fulfillmentRef: fulfillmentOrderId,
    });
    if (shipment.status !== 200 && shipment.status !== 404) return shipment;
    return {
      status: 200,
      body: {
        fulfillmentOrderId,
        shipment: shipment.status === 200 ? toShipmentDetailDto(shipment.body as Shipment) : null,
        carriers: (carriers.body as { carriers: unknown }).carriers,
      },
    };
  }
}
