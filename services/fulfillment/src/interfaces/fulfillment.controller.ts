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
}
