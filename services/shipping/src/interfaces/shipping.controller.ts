import type {
  CancelCarrierShipment,
  PrintCarrierAwbs,
  PrintCarrierAwbsInput,
  GetShipment,
} from "../application/carrier-shipment.use-cases";
import type { CreateShipment, CreateShipmentInput } from "../application/create-shipment.use-case";
import type {
  GetCarrierSettings,
  ListEnabledCarriers,
  RotateCarrierWebhookSecret,
  UpdateCarrierSettings,
  UpdateCarrierSettingsInput,
  VerifyCarrierWebhook,
} from "../application/carrier-settings.use-cases";
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
  CreateLabelInput,
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
  readonly cancelCarrierShipment: CancelCarrierShipment;
  readonly printCarrierAwbs: PrintCarrierAwbs;
  readonly getShipment: GetShipment;
  readonly voidLabel: VoidLabel;
  readonly updateTracking: UpdateTracking;
  readonly retryShipment: RetryShipment;
  readonly recordCarrierWebhook: RecordCarrierWebhook;
  readonly getShipmentByFulfillment: GetShipmentByFulfillment;
  readonly getCarrierSettings: GetCarrierSettings;
  readonly listEnabledCarriers: ListEnabledCarriers;
  readonly updateCarrierSettings: UpdateCarrierSettings;
  readonly rotateCarrierWebhookSecret: RotateCarrierWebhookSecret;
  readonly verifyCarrierWebhook: VerifyCarrierWebhook;
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

  async createLabel(input: CreateLabelInput): Promise<ControllerResponse> {
    return present(await this.deps.createLabel.execute(input), 200);
  }

  async cancelCarrierShipment(input: ShipmentIdInput): Promise<ControllerResponse> {
    return present(await this.deps.cancelCarrierShipment.execute(input), 200);
  }

  async printCarrierAwbs(input: PrintCarrierAwbsInput): Promise<ControllerResponse> {
    return present(await this.deps.printCarrierAwbs.execute(input), 200);
  }

  async getShipment(input: ShipmentIdInput): Promise<ControllerResponse> {
    return present(await this.deps.getShipment.execute(input), 200);
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

  async getCarrierSettings(input: { tenantId: string }): Promise<ControllerResponse> {
    return present(await this.deps.getCarrierSettings.execute(input), 200);
  }

  async listEnabledCarriers(input: { tenantId: string }): Promise<ControllerResponse> {
    return present(await this.deps.listEnabledCarriers.execute(input), 200);
  }

  async updateCarrierSettings(input: UpdateCarrierSettingsInput): Promise<ControllerResponse> {
    return present(await this.deps.updateCarrierSettings.execute(input), 200);
  }

  async rotateCarrierWebhookSecret(input: {
    tenantId: string;
    carrierKey: string;
  }): Promise<ControllerResponse> {
    return present(await this.deps.rotateCarrierWebhookSecret.execute(input), 200);
  }

  /** The webhook gate: a boolean that never says why it refused (spec §9a.1). */
  verifyCarrierWebhook(input: {
    tenantId: string;
    carrierKey: string;
    presented: string | undefined;
  }): Promise<boolean> {
    return this.deps.verifyCarrierWebhook.execute(input);
  }
}
