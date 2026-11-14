import type {
  AttachCarrierShipment,
  AttachCarrierShipmentInput,
  DetachCarrierShipment,
  MirrorShipmentStatus,
  MirrorShipmentStatusInput,
  PrepareForCarrierShipment,
} from "../application/carrier-fulfillment.use-cases";
import type {
  CreateFulfillment,
  CreateFulfillmentInput,
} from "../application/create-fulfillment.use-case";
import type { CreateShipment } from "../application/create-shipment.use-case";
import type {
  AdvanceFulfillment,
  AdvanceFulfillmentInput,
  FulfillmentOrderIdInput,
} from "../application/fulfillment-lifecycle.use-cases";
import type {
  GetFulfillmentByOrder,
  GetFulfillmentByOrderInput,
} from "../application/get-fulfillment-by-order.use-case";
import type {
  GetFulfillmentsByOrders,
  GetFulfillmentsByOrdersInput,
} from "../application/get-fulfillments-by-orders.use-case";
import type {
  RecordCarrierWebhook,
  RecordCarrierWebhookInput,
} from "../application/record-carrier-webhook.use-case";
import type { RequestReservation } from "../application/request-reservation.use-case";
import { type ControllerResponse, present } from "./presenter";

export interface FulfillmentControllerDeps {
  readonly createFulfillment: CreateFulfillment;
  readonly advanceFulfillment: AdvanceFulfillment;
  readonly requestReservation: RequestReservation;
  readonly createShipment: CreateShipment;
  readonly recordCarrierWebhook: RecordCarrierWebhook;
  readonly getFulfillmentByOrder: GetFulfillmentByOrder;
  readonly getFulfillmentsByOrders: GetFulfillmentsByOrders;
  readonly prepareForCarrierShipment: PrepareForCarrierShipment;
  readonly attachCarrierShipment: AttachCarrierShipment;
  readonly detachCarrierShipment: DetachCarrierShipment;
  readonly mirrorShipmentStatus: MirrorShipmentStatus;
}

/** Framework-agnostic interface boundary for fulfillment use-cases (no HTTP server). */
export class FulfillmentController {
  private readonly deps: FulfillmentControllerDeps;

  constructor(deps: FulfillmentControllerDeps) {
    this.deps = deps;
  }

  async create(input: CreateFulfillmentInput): Promise<ControllerResponse> {
    return present(await this.deps.createFulfillment.execute(input), 201);
  }

  async advance(input: AdvanceFulfillmentInput): Promise<ControllerResponse> {
    return present(await this.deps.advanceFulfillment.execute(input), 200);
  }

  async reserve(input: FulfillmentOrderIdInput): Promise<ControllerResponse> {
    return present(await this.deps.requestReservation.execute(input), 200);
  }

  async ship(input: FulfillmentOrderIdInput): Promise<ControllerResponse> {
    return present(await this.deps.createShipment.execute(input), 200);
  }

  async recordWebhook(input: RecordCarrierWebhookInput): Promise<ControllerResponse> {
    return present(await this.deps.recordCarrierWebhook.execute(input), 200);
  }

  async getByOrder(input: GetFulfillmentByOrderInput): Promise<ControllerResponse> {
    return present(await this.deps.getFulfillmentByOrder.execute(input), 200);
  }

  /** Plan 3B: the fulfillment orders of a whole page of orders, in one read. */
  async getByOrders(input: GetFulfillmentsByOrdersInput): Promise<ControllerResponse> {
    return present(await this.deps.getFulfillmentsByOrders.execute(input), 200);
  }

  /** Local carriers (spec 9a.3): reserve, pick and pack in one call, ending at `packing_completed`. */
  async prepareForCarrier(input: FulfillmentOrderIdInput): Promise<ControllerResponse> {
    return present(await this.deps.prepareForCarrierShipment.execute(input), 200);
  }

  /** Records the carrier label (reference + tracking number); idempotent for the same tracking number. */
  async attachCarrierShipment(input: AttachCarrierShipmentInput): Promise<ControllerResponse> {
    return present(await this.deps.attachCarrierShipment.execute(input), 200);
  }

  /** Voids the label before pickup: back to `packing_completed`. */
  async detachCarrierShipment(input: FulfillmentOrderIdInput): Promise<ControllerResponse> {
    return present(await this.deps.detachCarrierShipment.execute(input), 200);
  }

  /** Mirrors a shipment status onto the fulfillment order (spec 9a.4); never an error for a late scan. */
  async mirrorShipmentStatus(input: MirrorShipmentStatusInput): Promise<ControllerResponse> {
    return present(await this.deps.mirrorShipmentStatus.execute(input), 200);
  }
}
