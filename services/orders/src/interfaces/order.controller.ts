import type {
  CreateOrderFromCheckout,
  CreateOrderFromCheckoutInput,
} from "../application/create-order-from-checkout.use-case";
import type { GetOrder, GetOrderInput } from "../application/get-order.use-case";
import type { ListOrders, ListOrdersInput } from "../application/list-orders.use-case";
import type { MarkOrderPaid, MarkOrderPaidInput } from "../application/mark-order-paid.use-case";
import type {
  AdvanceOrder,
  AdvanceOrderInput,
  OrderIdInput,
  RequestFulfillment,
  RequestPaymentCapture,
} from "../application/order-lifecycle.use-cases";
import type { PlaceOrder, PlaceOrderInput } from "../application/place-order.use-case";
import type { RefundOrder, RefundOrderInput } from "../application/refund-order.use-case";
import { type ControllerResponse, present } from "./presenter";

export interface OrderControllerDeps {
  readonly placeOrder: PlaceOrder;
  readonly markOrderPaid: MarkOrderPaid;
  readonly refundOrder: RefundOrder;
  readonly createOrderFromCheckout: CreateOrderFromCheckout;
  readonly advanceOrder: AdvanceOrder;
  readonly requestPaymentCapture: RequestPaymentCapture;
  readonly requestFulfillment: RequestFulfillment;
  readonly getOrder: GetOrder;
  readonly listOrders: ListOrders;
}

/** Framework-agnostic interface boundary for order use-cases (no HTTP server). */
export class OrderController {
  private readonly deps: OrderControllerDeps;

  constructor(deps: OrderControllerDeps) {
    this.deps = deps;
  }

  async place(input: PlaceOrderInput): Promise<ControllerResponse> {
    return present(await this.deps.placeOrder.execute(input), 201);
  }

  async markPaid(input: MarkOrderPaidInput): Promise<ControllerResponse> {
    return present(await this.deps.markOrderPaid.execute(input), 200);
  }

  async refund(input: RefundOrderInput): Promise<ControllerResponse> {
    return present(await this.deps.refundOrder.execute(input), 200);
  }

  async createFromCheckout(input: CreateOrderFromCheckoutInput): Promise<ControllerResponse> {
    return present(await this.deps.createOrderFromCheckout.execute(input), 201);
  }

  async advance(input: AdvanceOrderInput): Promise<ControllerResponse> {
    return present(await this.deps.advanceOrder.execute(input), 200);
  }

  async requestPaymentCapture(input: OrderIdInput): Promise<ControllerResponse> {
    return present(await this.deps.requestPaymentCapture.execute(input), 200);
  }

  async requestFulfillment(input: OrderIdInput): Promise<ControllerResponse> {
    return present(await this.deps.requestFulfillment.execute(input), 200);
  }

  async getOrder(input: GetOrderInput): Promise<ControllerResponse> {
    return present(await this.deps.getOrder.execute(input), 200);
  }

  async listOrders(input: ListOrdersInput): Promise<ControllerResponse> {
    return present(await this.deps.listOrders.execute(input), 200);
  }
}
