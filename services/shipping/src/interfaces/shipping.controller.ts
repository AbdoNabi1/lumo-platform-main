import type { CreateShipment, CreateShipmentInput } from "../application/create-shipment.use-case";
import type {
  GetShipmentByFulfillment,
  GetShipmentByFulfillmentInput,
} from "../application/get-shipment-by-fulfillment.use-case";
import type {
  RecordCarrierWebhook,
  RecordCarrierWebhookInput,
} from "../application/record-carrier-webhook.use-case";
import type {
  AdvanceShipment,
  AdvanceShipmentInput,
  CreateLabel,
  RetryShipment,
  ShipmentIdInput,
  UpdateTracking,
  UpdateTrackingInput,
  VoidLabel,
} from "../application/shipment-lifecycle.use-cases";
import { type ControllerResponse, present } from "./presenter";

export interface ShippingControllerDeps {
  readonly createShipment: CreateShipment;
  readonly advanceShipment: AdvanceShipment;
  readonly createLabel: CreateLabel;
  readonly voidLabel: VoidLabel;
  readonly updateTracking: UpdateTracking;
  readonly retryShipment: RetryShipment;
  readonly recordCarrierWebhook: RecordCarrierWebhook;
  readonly getShipmentByFulfillment: GetShipmentByFulfillment;
}

/** Framework-agnostic interface boundary for shipping use-cases (no HTTP server). */
export class ShippingController {
  private readonly deps: ShippingControllerDeps;

  constructor(deps: ShippingControllerDeps) {
    this.deps = deps;
  }

  async create(input: CreateShipmentInput): Promise<ControllerResponse> {
    return present(await this.deps.createShipment.execute(input), 201);
  }

  async advance(input: AdvanceShipmentInput): Promise<ControllerResponse> {
    return present(await this.deps.advanceShipment.execute(input), 200);
  }

  async createLabel(input: ShipmentIdInput): Promise<ControllerResponse> {
    return present(await this.deps.createLabel.execute(input), 200);
  }

  async voidLabel(input: ShipmentIdInput): Promise<ControllerResponse> {
    return present(await this.deps.voidLabel.execute(input), 200);
  }

  async updateTracking(input: UpdateTrackingInput): Promise<ControllerResponse> {
    return present(await this.deps.updateTracking.execute(input), 200);
  }

  async retry(input: ShipmentIdInput): Promise<ControllerResponse> {
    return present(await this.deps.retryShipment.execute(input), 200);
  }

  async recordWebhook(input: RecordCarrierWebhookInput): Promise<ControllerResponse> {
    return present(await this.deps.recordCarrierWebhook.execute(input), 200);
  }

  async getByFulfillment(input: GetShipmentByFulfillmentInput): Promise<ControllerResponse> {
    return present(await this.deps.getShipmentByFulfillment.execute(input), 200);
  }
}
