import {
  derivePaymentStatus,
  isOpenOrder,
  type Order,
  type OrderController,
} from "@platform/orders";
import type { PaymentController, PaymentIntent } from "@platform/payments";
import { lineKey } from "../http/product-images";
import type { CarrierOrderReader, CodIntentFacts, ShippableOrder } from "./ports";

export class CarrierOrderAdapter implements CarrierOrderReader {
  constructor(
    private readonly deps: {
      orders: Pick<OrderController, "getOrder">;
      payments: Pick<PaymentController, "getPaymentIntent">;
      lineImageUrls: (
        tenantId: string,
        lines: readonly { productId: string; variantId: string | null }[],
      ) => Promise<ReadonlyMap<string, string | null>>;
    },
  ) {}
  async read(tenantId: string, orderId: string): Promise<ShippableOrder | null> {
    const response = await this.deps.orders.getOrder({ tenantId, orderId });
    if (response.status !== 200) return null;
    const order = response.body as Order;
    const lines = order.items.map((item) => ({
      productId: item.snapshot.productId,
      variantId: item.snapshot.variantRef ?? null,
    }));
    const images = await this.deps.lineImageUrls(tenantId, lines);
    return {
      orderId: order.id.toString(),
      orderNumber: order.orderNumber.value,
      open: isOpenOrder(order.history),
      paymentStatus: derivePaymentStatus(order.history),
      totalMinor: order.totalAmount().amountMinor,
      currency: order.currency,
      ...(order.paymentRef === undefined ? {} : { paymentRef: order.paymentRef }),
      shippingAddress: order.shippingAddress,
      items: order.items.map((item) => ({
        productId: item.snapshot.productId,
        name: item.snapshot.name,
        variantTitle: item.snapshot.variantTitle ?? null,
        quantity: item.quantity,
        imageUrl:
          images.get(lineKey(item.snapshot.productId, item.snapshot.variantRef ?? null)) ?? null,
      })),
    };
  }
  async codIntent(tenantId: string, paymentRef: string): Promise<CodIntentFacts | null> {
    const response = await this.deps.payments.getPaymentIntent({
      tenantId,
      paymentIntentId: paymentRef,
    });
    if (response.status !== 200) return null;
    const intent = response.body as PaymentIntent;
    return {
      provider: intent.provider,
      status: intent.status.value,
      amountMinor: intent.amount.amountMinor,
      currency: intent.amount.currency,
    };
  }
}
