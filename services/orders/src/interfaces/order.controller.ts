import type {
  CreateOrderFromCheckout,
  CreateOrderFromCheckoutInput,
} from "../application/create-order-from-checkout.use-case";
import type { GetOrder, GetOrderInput } from "../application/get-order.use-case";
import type { GetSalesSummary } from "../application/get-sales-summary.use-case";
import type { SalesSummaryInput } from "../application/sales-summary";
import type { ListOrders, ListOrdersInput } from "../application/list-orders.use-case";
import type { MarkOrderPaid, MarkOrderPaidInput } from "../application/mark-order-paid.use-case";
import type {
  AddOrderTags,
  ArchiveOrders,
  ArchiveOrdersInput,
  ChangeOrderTagsInput,
  GetOrderAnnotations,
  GetOrderAnnotationsInput,
  RemoveOrderTags,
  SuggestOrderTags,
  SuggestOrderTagsInput,
  UnarchiveOrders,
  UpdateOrderNote,
  UpdateOrderNoteInput,
} from "../application/order-annotations.use-cases";
import type {
  AddOrderComment,
  AddOrderCommentInput,
  DeleteOrderComment,
  DeleteOrderCommentInput,
  EditOrderComment,
  EditOrderCommentInput,
  ListOrderTimeline,
  ListOrderTimelineInput,
} from "../application/order-timeline.use-cases";
import type {
  AdvanceOrder,
  AdvanceOrderInput,
  OrderIdInput,
  RequestFulfillment,
  RequestPaymentCapture,
} from "../application/order-lifecycle.use-cases";
import type { PlaceOrder, PlaceOrderInput } from "../application/place-order.use-case";
import type {
  RecordCheckoutPayment,
  RecordCheckoutPaymentInput,
} from "../application/record-checkout-payment.use-case";
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
  readonly recordCheckoutPayment: RecordCheckoutPayment;
  readonly getOrder: GetOrder;
  readonly listOrders: ListOrders;
  readonly getSalesSummary: GetSalesSummary;
  readonly archiveOrders: ArchiveOrders;
  readonly unarchiveOrders: UnarchiveOrders;
  readonly getOrderAnnotations: GetOrderAnnotations;
  readonly updateOrderNote: UpdateOrderNote;
  readonly addOrderTags: AddOrderTags;
  readonly removeOrderTags: RemoveOrderTags;
  readonly suggestOrderTags: SuggestOrderTags;
  readonly addOrderComment: AddOrderComment;
  readonly editOrderComment: EditOrderComment;
  readonly deleteOrderComment: DeleteOrderComment;
  readonly listOrderTimeline: ListOrderTimeline;
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

  /** Links the payment Payments opened for a checkout order to that order (closes G-121). */
  async recordCheckoutPayment(input: RecordCheckoutPaymentInput): Promise<ControllerResponse> {
    return present(await this.deps.recordCheckoutPayment.execute(input), 200);
  }

  async getOrder(input: GetOrderInput): Promise<ControllerResponse> {
    return present(await this.deps.getOrder.execute(input), 200);
  }

  async listOrders(input: ListOrdersInput): Promise<ControllerResponse> {
    return present(await this.deps.listOrders.execute(input), 200);
  }

  /** The dashboard's sales figures for one range (Plan 3D); a read model, nothing is written. */
  async salesSummary(input: SalesSummaryInput): Promise<ControllerResponse> {
    return present(await this.deps.getSalesSummary.execute(input), 200);
  }

  /** Order operations Part 1: Shopify's Archive (outside the aggregate; idempotent). */
  async archiveOrders(input: ArchiveOrdersInput): Promise<ControllerResponse> {
    return present(await this.deps.archiveOrders.execute(input), 200);
  }

  async unarchiveOrders(input: ArchiveOrdersInput): Promise<ControllerResponse> {
    return present(await this.deps.unarchiveOrders.execute(input), 200);
  }

  /** The annotations of a page of orders, in one read (body: `ReadonlyMap<string, OrderAnnotations>`). */
  async orderAnnotations(input: GetOrderAnnotationsInput): Promise<ControllerResponse> {
    return present(await this.deps.getOrderAnnotations.execute(input), 200);
  }

  /** Part 2: the order note (outside the aggregate; writes its `note_changed` line). */
  async updateOrderNote(input: UpdateOrderNoteInput): Promise<ControllerResponse> {
    return present(await this.deps.updateOrderNote.execute(input), 200);
  }

  async addOrderTags(input: ChangeOrderTagsInput): Promise<ControllerResponse> {
    return present(await this.deps.addOrderTags.execute(input), 200);
  }

  async removeOrderTags(input: ChangeOrderTagsInput): Promise<ControllerResponse> {
    return present(await this.deps.removeOrderTags.execute(input), 200);
  }

  async suggestOrderTags(input: SuggestOrderTagsInput): Promise<ControllerResponse> {
    return present(await this.deps.suggestOrderTags.execute(input), 200);
  }

  async addOrderComment(input: AddOrderCommentInput): Promise<ControllerResponse> {
    return present(await this.deps.addOrderComment.execute(input), 201);
  }

  async editOrderComment(input: EditOrderCommentInput): Promise<ControllerResponse> {
    return present(await this.deps.editOrderComment.execute(input), 200);
  }

  async deleteOrderComment(input: DeleteOrderCommentInput): Promise<ControllerResponse> {
    return present(await this.deps.deleteOrderComment.execute(input), 200);
  }

  /** The order's staff timeline (body: `readonly OrderTimelineEntry[]`, newest first, ≤ 200). */
  async orderTimeline(input: ListOrderTimelineInput): Promise<ControllerResponse> {
    return present(await this.deps.listOrderTimeline.execute(input), 200);
  }
}
