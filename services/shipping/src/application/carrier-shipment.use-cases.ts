import { isDomainError } from "@platform/domain";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError, ValidationError } from "@platform/utils";
import { CarrierError } from "../domain/errors";
import type { Shipment } from "../domain/shipment";
import { carrierFailureOf } from "./carrier-provider";
import {
  CarrierResolutionError,
  carrierResolutionToError,
  type CarrierResolver,
} from "./carrier-resolver";
import { withConcurrencyRetry } from "./concurrency-retry";
import type { ShipmentStatusOutput } from "./create-shipment.use-case";
import {
  notifyBestEffort,
  type ShipmentIdInput,
  type ShipmentLifecycleDeps,
} from "./shipment-lifecycle.use-cases";

export interface CarrierShipmentDeps extends ShipmentLifecycleDeps {
  readonly carriers: CarrierResolver;
}
export interface PrintCarrierAwbsInput {
  readonly tenantId: string;
  readonly shipmentIds: readonly string[];
  readonly format?: "A4" | "A6";
  readonly lang?: "ar" | "en";
}

export class CancelCarrierShipment {
  constructor(private readonly deps: CarrierShipmentDeps) {}
  async execute(
    input: ShipmentIdInput,
  ): Promise<
    Result<
      ShipmentStatusOutput & { readonly fulfillmentRef: string; readonly trackingNumber?: string },
      DomainError
    >
  > {
    const precheck = await this.deps.unitOfWork.run(async (tx) => {
      const shipment = await this.deps.shipments.findById(input.shipmentId, input.tenantId, tx);
      if (shipment === null) return err(new NotFoundError("Shipment not found"));
      if (shipment.status.value === "voided")
        return ok({
          done: true as const,
          output: {
            shipmentId: input.shipmentId,
            status: shipment.status.value,
            fulfillmentRef: shipment.fulfillmentRef,
            ...(shipment.trackingNumber ? { trackingNumber: shipment.trackingNumber.value } : {}),
          },
        });
      if (
        shipment.label === undefined ||
        shipment.carrier === undefined ||
        shipment.trackingNumber === undefined
      )
        return err(new ValidationError("Shipment has no carrier label", []));
      if (shipment.status.value !== "label_created")
        return err(
          new CarrierError(
            "CARRIER_CANCEL_NOT_ALLOWED",
            "Shipment can no longer be cancelled",
            409,
          ),
        );
      return ok({
        done: false as const,
        carrier: shipment.carrier.value,
        tracking: shipment.trackingNumber.value,
      });
    });
    if (!precheck.ok) return err(precheck.error);
    if (precheck.value.done) return ok(precheck.value.output);
    const { carrier, tracking } = precheck.value;
    try {
      const provider = await this.deps.carriers.resolve(
        input.tenantId,
        carrier,
        "existing_shipment",
      );
      await provider.cancelDelivery(tracking);
    } catch (error) {
      if (error instanceof CarrierResolutionError) return err(carrierResolutionToError(error));
      const failure = carrierFailureOf(error);
      if (failure === null) throw error;
      return failure.carrierFailure === "rejected"
        ? err(new CarrierError("CARRIER_CANCEL_REFUSED", "Carrier refused cancellation", 409))
        : err(new CarrierError("CARRIER_UNAVAILABLE", "Carrier unavailable", 503));
    }
    return withConcurrencyRetry(5, () =>
      this.deps.unitOfWork.run(async (tx) => {
        const shipment = await this.deps.shipments.findById(input.shipmentId, input.tenantId, tx);
        if (shipment === null) return err(new NotFoundError("Shipment not found"));
        if (shipment.status.value !== "voided") {
          if (
            shipment.status.value !== "label_created" ||
            shipment.trackingNumber?.value !== tracking
          )
            return err(
              new CarrierError(
                "CARRIER_CANCEL_NOT_ALLOWED",
                "Shipment can no longer be cancelled",
                409,
              ),
            );
          try {
            shipment.voidLabel(this.deps.idGenerator.generate(), this.deps.clock.now());
          } catch (error) {
            if (isDomainError(error)) return err(error);
            throw error;
          }
          await this.deps.shipments.save(shipment, input.tenantId, tx);
          await notifyBestEffort(this.deps, shipment);
        }
        return ok({
          shipmentId: input.shipmentId,
          status: shipment.status.value,
          fulfillmentRef: shipment.fulfillmentRef,
          trackingNumber: tracking,
        });
      }),
    );
  }
}

export class PrintCarrierAwbs {
  constructor(private readonly deps: CarrierShipmentDeps) {}
  async execute(
    input: PrintCarrierAwbsInput,
  ): Promise<Result<{ readonly pdf: Uint8Array }, DomainError>> {
    if (input.shipmentIds.length < 1 || input.shipmentIds.length > 50)
      return err(new ValidationError("Select 1–50 shipments", []));
    const ids = [...new Set(input.shipmentIds)];
    const rows = await this.deps.unitOfWork.run(async (tx) => {
      const found: Shipment[] = [];
      for (const id of ids) {
        const shipment = await this.deps.shipments.findById(id, input.tenantId, tx);
        if (shipment === null) return err(new NotFoundError("Shipment not found"));
        if (
          shipment.label === undefined ||
          shipment.carrier === undefined ||
          shipment.trackingNumber === undefined ||
          ["created", "voided", "cancelled"].includes(shipment.status.value)
        )
          return err(new CarrierError("AWB_NOT_AVAILABLE", "Waybill is unavailable", 409));
        found.push(shipment);
      }
      return ok(found);
    });
    if (!rows.ok) return err(rows.error);
    const carrier = rows.value[0]!.carrier!.value;
    if (rows.value.some((shipment) => shipment.carrier!.value !== carrier))
      return err(new CarrierError("AWB_MIXED_CARRIERS", "Choose one carrier", 422));
    try {
      const provider = await this.deps.carriers.resolve(
        input.tenantId,
        carrier,
        "existing_shipment",
      );
      const options = {
        ...(input.format === undefined ? {} : { format: input.format }),
        ...(input.lang === undefined ? {} : { lang: input.lang }),
      };
      const pdf = await provider.printAwbs(
        rows.value.map((shipment) => shipment.trackingNumber!.value),
        options,
      );
      return ok({ pdf });
    } catch (error) {
      if (error instanceof CarrierResolutionError) return err(carrierResolutionToError(error));
      if (carrierFailureOf(error) !== null)
        return err(new CarrierError("CARRIER_UNAVAILABLE", "Carrier unavailable", 503));
      throw error;
    }
  }
}

export class GetShipment {
  constructor(private readonly deps: ShipmentLifecycleDeps) {}
  async execute(input: ShipmentIdInput): Promise<Result<Shipment, DomainError>> {
    const shipment = await this.deps.shipments.findById(input.shipmentId, input.tenantId);
    return shipment === null ? err(new NotFoundError("Shipment not found")) : ok(shipment);
  }
}
