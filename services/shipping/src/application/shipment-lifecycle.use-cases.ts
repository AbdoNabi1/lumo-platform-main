import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { BusinessRuleError, Guard, isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError, ValidationError } from "@platform/utils";
import type { Shipment } from "../domain/shipment";
import type { ShipmentRepository } from "../domain/shipment-repository";
import { Carrier, CarrierService } from "../domain/value-objects/carrier";
import { ShippingLabel } from "../domain/value-objects/shipping-label";
import { TrackingNumber } from "../domain/value-objects/tracking-number";
import {
  canTransitionShipment,
  type ShipmentStatusValue,
} from "../domain/value-objects/shipment-status";
import type { ShipmentStatusOutput } from "./create-shipment.use-case";
import { withConcurrencyRetry } from "./concurrency-retry";
import type { CarrierProviderPort, FulfillmentPort, NotificationPort } from "./ports";
import { CarrierError } from "../domain/errors";
import {
  carrierFailureOf,
  type CarrierDelivery,
  type CarrierParcelRequest,
  type CarrierProvider,
} from "./carrier-provider";
import {
  CarrierResolutionError,
  carrierResolutionToError,
  type CarrierResolver,
} from "./carrier-resolver";

export interface ShipmentIdInput {
  /** ADR-0014: the caller's verified tenant. */
  readonly tenantId: string;
  readonly shipmentId: string;
}

export interface AdvanceShipmentInput extends ShipmentIdInput {
  readonly toStatus: ShipmentStatusValue;
}

export interface ShipmentLifecycleDeps {
  readonly shipments: ShipmentRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly fulfillmentPort?: FulfillmentPort;
  readonly notifications?: NotificationPort;
  readonly isCarrierManaged?: (carrierKey: string) => boolean;
}

export async function notifyBestEffort(
  deps: ShipmentLifecycleDeps,
  shipment: Shipment,
): Promise<void> {
  try {
    await deps.fulfillmentPort?.reportShipmentOutcome(
      shipment.fulfillmentRef,
      shipment.status.value,
    );
    await deps.notifications?.notify(shipment.fulfillmentRef, shipment.status.value);
  } catch {
    // Best-effort: a reference-only notification failure never fails the transition's own result.
  }
}

/** Generic validated transition — moves a shipment to any status its current status's transition table allows, then fans out Fulfillment/Notifications best-effort. */
export class AdvanceShipment implements UseCase<
  AdvanceShipmentInput,
  ShipmentStatusOutput,
  DomainError
> {
  private readonly deps: ShipmentLifecycleDeps;

  constructor(deps: ShipmentLifecycleDeps) {
    this.deps = deps;
  }

  async execute(input: AdvanceShipmentInput): Promise<Result<ShipmentStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<ShipmentStatusOutput, DomainError>>(async (tx) => {
      const shipment = await this.deps.shipments.findById(input.shipmentId, input.tenantId, tx);
      if (shipment === null) {
        return err(new NotFoundError("Shipment not found"));
      }

      if (
        shipment.carrier !== undefined &&
        this.deps.isCarrierManaged?.(shipment.carrier.value) === true &&
        !(shipment.status.value === "voided" && input.toStatus === "created")
      ) {
        return err(
          new CarrierError("CARRIER_USE_CANCEL", "Use the carrier cancel for this shipment", 409),
        );
      }
      try {
        shipment.transition(
          input.toStatus,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.shipments.save(shipment, input.tenantId, tx);
      await notifyBestEffort(this.deps, shipment);
      return ok({ shipmentId: shipment.id.toString(), status: shipment.status.value });
    });
  }
}

export interface CarrierLabelDetails extends CarrierParcelRequest {
  readonly carrierKey: string;
  readonly reference: string;
}
export interface CreateLabelInput extends ShipmentIdInput {
  readonly carrier?: CarrierLabelDetails;
}
export interface CreateLabelOutput extends ShipmentStatusOutput {
  readonly trackingNumber?: string;
  readonly carrierDeliveryId?: string;
  readonly carrierKey?: string;
}
export const IN_FLIGHT_GRACE_MS = 120_000;
export interface CreateLabelDeps extends ShipmentLifecycleDeps {
  readonly carrierProvider: CarrierProviderPort;
  readonly carriers?: CarrierResolver;
}

interface CreateLabelPrecheck {
  /** Shipment is already `label_created` (idempotent resume) — skip the carrier call and return current status as-is. */
  readonly alreadyLabeled: boolean;
  readonly fulfillmentRef: string;
  readonly status: ShipmentStatusValue;
}

/**
 * Requests a label from the carrier (`CarrierProviderPort.createLabel`, idempotency-keyed) —
 * records the label, carrier, service, and tracking number, and transitions to `label_created`.
 * Shipping never talks to a carrier SDK directly.
 *
 * Phase A.15 (Shipping, Task 1/2): the carrier `createLabel()` call used to run INSIDE the same
 * `unitOfWork.run` transaction that read and would eventually persist the shipment, holding a DB
 * connection open for the full duration of a real network round-trip (A.14 §11 finding — the same
 * anti-pattern already closed for Payments/Returns/Licensing). `Shipment`'s status machine
 * (`created → label_created/voided → ...`) has no intermediate `label_requested` status to durably
 * reserve before the carrier call — adding one would be a schema/business-semantics change out of
 * this phase's scope absent a concrete defect requiring it — so this reuses the simple
 * precheck/external-call/settle shape Returns' `DecideResolution` (A.13.1) and Licensing's
 * `CollectInvoice` (A.15) established for that exact case:
 *   1. `precheck` — a short read-only transaction: 404s if missing, short-circuits idempotently if
 *      already `label_created` (a retry of a call that already succeeded — no second carrier
 *      label), and rejects (same `BusinessRuleError` shape `Shipment.transition` would have thrown)
 *      if the current status cannot reach `label_created`.
 *   2. The carrier `createLabel()` call, deliberately outside any open transaction.
 *   3. `settle` — re-reads the shipment (a concurrent racer may have already labeled it — resumed
 *      as a no-op), applies `createLabel`, and commits.
 *
 * Carrier-call failure recovery: `precheck` never mutates anything (a plain read), so on a thrown
 * carrier error there is nothing to revert — the shipment simply stays at its pre-call status,
 * exactly as the pre-fix single-transaction version left it on rollback. The error is rethrown
 * unchanged (no `settleFailure` step needed here, unlike `CollectInvoice`/`CapturePaymentLifecycle`,
 * because there is no in-flight status to unwind).
 */
export class CreateLabel implements UseCase<CreateLabelInput, CreateLabelOutput, DomainError> {
  private readonly deps: CreateLabelDeps;
  private static readonly MAX_CONCURRENCY_RETRIES = 5;

  constructor(deps: CreateLabelDeps) {
    this.deps = deps;
  }

  async execute(input: CreateLabelInput): Promise<Result<CreateLabelOutput, DomainError>> {
    if (input.carrier !== undefined) return this.executeCarrier(input, input.carrier);
    const precheck = await this.precheck(input.shipmentId, input.tenantId);
    if (!precheck.ok) return err(precheck.error);
    if (precheck.value.alreadyLabeled) {
      return ok({ shipmentId: input.shipmentId, status: precheck.value.status });
    }
    const { fulfillmentRef } = precheck.value;

    const providerLabel = await this.deps.carrierProvider.createLabel({
      shipmentId: input.shipmentId,
      fulfillmentRef,
      idempotencyKey: `${input.shipmentId}:label`,
    });

    const carrier = Carrier.create(providerLabel.carrier);
    if (!carrier.ok) return err(carrier.error);
    const carrierService = CarrierService.create(providerLabel.carrierService);
    if (!carrierService.ok) return err(carrierService.error);
    const label = ShippingLabel.create(providerLabel.labelId, providerLabel.trackingNumber);
    if (!label.ok) return err(label.error);
    const trackingNumber = TrackingNumber.create(providerLabel.trackingNumber);
    if (!trackingNumber.ok) return err(trackingNumber.error);

    return this.settle(
      input.shipmentId,
      input.tenantId,
      label.value,
      carrier.value,
      carrierService.value,
      trackingNumber.value,
    );
  }

  private async executeCarrier(
    input: ShipmentIdInput,
    details: CarrierLabelDetails,
  ): Promise<Result<CreateLabelOutput, DomainError>> {
    const precheck = await this.deps.unitOfWork.run(async (tx) => {
      const shipment = await this.deps.shipments.findById(input.shipmentId, input.tenantId, tx);
      if (shipment === null) return err(new NotFoundError("Shipment not found"));
      if (shipment.status.value === "label_created")
        return ok({ mode: "done" as const, output: this.labelOutput(shipment) });
      if (shipment.status.value === "exception")
        return err(
          new CarrierError("SHIPMENT_NEEDS_REVIEW", "Check the carrier before retrying", 409),
        );
      const pending = shipment.pendingLabelAttempt();
      if (pending?.reference !== undefined)
        return ok({
          mode: "resume" as const,
          reference: pending.reference,
          startedAt: pending.occurredAt,
        });
      return ok({ mode: "fresh" as const });
    });
    if (!precheck.ok) return err(precheck.error);
    if (precheck.value.mode === "done") return ok(precheck.value.output);
    let provider: CarrierProvider;
    try {
      if (this.deps.carriers === undefined)
        return err(new CarrierError("CARRIER_NOT_AVAILABLE", "Carrier unavailable", 409));
      provider = await this.deps.carriers.resolve(
        input.tenantId,
        details.carrierKey,
        precheck.value.mode === "fresh" ? "new_shipment" : "existing_shipment",
      );
    } catch (error) {
      if (error instanceof CarrierResolutionError) return err(carrierResolutionToError(error));
      throw error;
    }
    if (precheck.value.mode === "resume") {
      const { reference, startedAt } = precheck.value;
      if (this.deps.clock.now().getTime() - startedAt.getTime() < IN_FLIGHT_GRACE_MS)
        return err(
          new CarrierError("CARRIER_CREATE_IN_PROGRESS", "Carrier request is in progress", 409),
        );
      let deliveries: readonly CarrierDelivery[];
      try {
        deliveries = await provider.findDeliveriesByReference(reference);
      } catch {
        return this.unknown(input, reference);
      }
      if (deliveries.length > 1) return this.unknown(input, reference);
      if (deliveries.length === 1)
        return this.settleCarrier(input, details.carrierKey, reference, deliveries[0]!);
      const problem = await this.prepareCarrier(provider, details);
      if (!problem.ok) {
        if (problem.error.httpStatus === 422) await this.failAttempt(input, reference);
        return err(problem.error);
      }
      return this.createCarrier(input, details, provider, reference, true);
    }
    const prepared = await this.prepareCarrier(provider, details);
    if (!prepared.ok) return err(prepared.error);
    const begun = await withConcurrencyRetry(5, () =>
      this.deps.unitOfWork.run(async (tx) => {
        const shipment = await this.deps.shipments.findById(input.shipmentId, input.tenantId, tx);
        if (shipment === null) return err(new NotFoundError("Shipment not found"));
        if (shipment.status.value === "label_created")
          return ok({ output: this.labelOutput(shipment) });
        if (shipment.pendingLabelAttempt() !== undefined)
          return err(
            new CarrierError("CARRIER_CREATE_IN_PROGRESS", "Carrier request is in progress", 409),
          );
        if (!canTransitionShipment(shipment.status.value, "label_created"))
          return err(
            new BusinessRuleError(
              `Cannot transition shipment from "${shipment.status.value}" to "label_created"`,
            ),
          );
        const reference = shipment.nextLabelReference(details.reference);
        shipment.beginLabelAttempt(reference, this.deps.clock.now());
        await this.deps.shipments.save(shipment, input.tenantId, tx);
        return ok({ reference });
      }),
    );
    if (!begun.ok) return err(begun.error);
    if ("output" in begun.value) return ok(begun.value.output);
    return this.createCarrier(input, details, provider, begun.value.reference, false);
  }

  private labelOutput(shipment: Shipment): CreateLabelOutput {
    return {
      shipmentId: shipment.id.toString(),
      status: shipment.status.value,
      trackingNumber: shipment.trackingNumber?.value,
      carrierDeliveryId: shipment.label?.carrierDeliveryId,
      carrierKey: shipment.carrier?.value,
    };
  }

  private async prepareCarrier(
    provider: CarrierProvider,
    details: CarrierLabelDetails,
  ): Promise<Result<void, CarrierError>> {
    try {
      const problem = await provider.prepare(details);
      return problem === null
        ? ok(undefined)
        : err(
            new CarrierError(
              problem.code,
              "Carrier cannot prepare this shipment",
              422,
              problem.reason,
            ),
          );
    } catch (error) {
      if (carrierFailureOf(error) !== null)
        return err(new CarrierError("CARRIER_UNAVAILABLE", "Carrier unavailable", 503));
      throw error;
    }
  }

  private async createCarrier(
    input: ShipmentIdInput,
    details: CarrierLabelDetails,
    provider: CarrierProvider,
    reference: string,
    resumed: boolean,
  ): Promise<Result<CreateLabelOutput, DomainError>> {
    try {
      const delivery = await provider.createDelivery({ ...details, reference });
      return this.settleCarrier(input, details.carrierKey, reference, delivery);
    } catch (error) {
      const failure = carrierFailureOf(error);
      if (failure === null) throw error;
      if (failure.carrierFailure === "unavailable")
        return err(
          new CarrierError(
            failure.timedOut ? "CARRIER_TIMEOUT" : "CARRIER_UNAVAILABLE",
            "Carrier unavailable",
            503,
          ),
        );
      if (resumed) return this.unknown(input, reference);
      await this.failAttempt(input, reference);
      return failure.carrierFailure === "credentials_rejected"
        ? err(new CarrierError("CARRIER_CREDENTIALS_REJECTED", "Carrier credentials rejected", 409))
        : err(
            new CarrierError(
              failure.code ?? "CARRIER_REJECTED",
              "Carrier rejected the shipment",
              422,
              failure.reason,
            ),
          );
    }
  }

  private async failAttempt(input: ShipmentIdInput, reference: string): Promise<void> {
    await withConcurrencyRetry(5, () =>
      this.deps.unitOfWork.run(async (tx) => {
        const shipment = await this.deps.shipments.findById(input.shipmentId, input.tenantId, tx);
        if (shipment?.pendingLabelAttempt()?.reference === reference) {
          shipment.failLabelAttempt(reference, this.deps.clock.now());
          await this.deps.shipments.save(shipment, input.tenantId, tx);
        }
      }),
    );
  }

  private async unknown(
    input: ShipmentIdInput,
    reference: string,
  ): Promise<Result<CreateLabelOutput, DomainError>> {
    await withConcurrencyRetry(5, () =>
      this.deps.unitOfWork.run(async (tx) => {
        const shipment = await this.deps.shipments.findById(input.shipmentId, input.tenantId, tx);
        if (
          shipment?.status.value === "created" &&
          shipment.pendingLabelAttempt()?.reference === reference
        ) {
          shipment.markCarrierResultUnknown(
            reference,
            this.deps.idGenerator.generate(),
            this.deps.clock.now(),
          );
          await this.deps.shipments.save(shipment, input.tenantId, tx);
        }
      }),
    );
    return err(
      new CarrierError("CARRIER_RESULT_UNKNOWN", "Check the carrier before retrying", 409),
    );
  }

  private async settleCarrier(
    input: ShipmentIdInput,
    key: string,
    reference: string,
    delivery: CarrierDelivery,
  ): Promise<Result<CreateLabelOutput, DomainError>> {
    const label = ShippingLabel.create(
      delivery.deliveryId,
      delivery.trackingNumber,
      delivery.deliveryId,
    );
    if (!label.ok) return err(label.error);
    const carrier = Carrier.create(key);
    if (!carrier.ok) return err(carrier.error);
    const service = CarrierService.create("standard");
    if (!service.ok) return err(service.error);
    const tracking = TrackingNumber.create(delivery.trackingNumber);
    if (!tracking.ok) return err(tracking.error);
    return withConcurrencyRetry(5, () =>
      this.deps.unitOfWork.run(async (tx) => {
        const shipment = await this.deps.shipments.findById(input.shipmentId, input.tenantId, tx);
        if (shipment === null) return err(new NotFoundError("Shipment not found"));
        if (shipment.status.value === "label_created") {
          const isSameDelivery =
            shipment.trackingNumber?.value === delivery.trackingNumber &&
            shipment.label?.carrierDeliveryId === delivery.deliveryId &&
            shipment.carrier?.value === key;
          return isSameDelivery
            ? ok(this.labelOutput(shipment))
            : err(
                new CarrierError(
                  "CARRIER_RESULT_UNKNOWN",
                  "Check the carrier before retrying",
                  409,
                ),
              );
        }
        if (
          shipment.pendingLabelAttempt()?.reference !== reference ||
          !canTransitionShipment(shipment.status.value, "label_created")
        )
          return err(
            new CarrierError("CARRIER_RESULT_UNKNOWN", "Check the carrier before retrying", 409),
          );
        try {
          shipment.createLabel(
            label.value,
            carrier.value,
            service.value,
            tracking.value,
            this.deps.idGenerator.generate(),
            this.deps.clock.now(),
            reference,
          );
        } catch (error) {
          if (isDomainError(error)) return err(error);
          throw error;
        }
        await this.deps.shipments.save(shipment, input.tenantId, tx);
        await notifyBestEffort(this.deps, shipment);
        return ok(this.labelOutput(shipment));
      }),
    );
  }

  private async precheck(
    shipmentId: string,
    tenantId: string,
  ): Promise<Result<CreateLabelPrecheck, DomainError>> {
    return this.deps.unitOfWork.run<Result<CreateLabelPrecheck, DomainError>>(async (tx) => {
      const shipment = await this.deps.shipments.findById(shipmentId, tenantId, tx);
      if (shipment === null) {
        return err(new NotFoundError("Shipment not found"));
      }

      if (
        shipment.pendingLabelAttempt() !== undefined ||
        (shipment.carrier !== undefined &&
          this.deps.isCarrierManaged?.(shipment.carrier.value) === true) ||
        shipment.attempts.some(
          (a) => a.kind === "label" && a.reference !== undefined && /-\d+$/.test(a.reference),
        )
      ) {
        return err(
          new CarrierError("CARRIER_USE_CANCEL", "Use the carrier flow for this shipment", 409),
        );
      }
      const status = shipment.status.value;
      if (status === "label_created") {
        return ok({ alreadyLabeled: true, fulfillmentRef: shipment.fulfillmentRef, status });
      }
      if (!canTransitionShipment(status, "label_created")) {
        return err(
          new BusinessRuleError(`Cannot transition shipment from "${status}" to "label_created"`),
        );
      }
      return ok({ alreadyLabeled: false, fulfillmentRef: shipment.fulfillmentRef, status });
    });
  }

  private async settle(
    shipmentId: string,
    tenantId: string,
    label: ShippingLabel,
    carrier: Carrier,
    carrierService: CarrierService,
    trackingNumber: TrackingNumber,
  ): Promise<Result<ShipmentStatusOutput, DomainError>> {
    return withConcurrencyRetry(CreateLabel.MAX_CONCURRENCY_RETRIES, () =>
      this.deps.unitOfWork.run<Result<ShipmentStatusOutput, DomainError>>(async (tx) => {
        const shipment = await this.deps.shipments.findById(shipmentId, tenantId, tx);
        if (shipment === null) {
          return err(new NotFoundError("Shipment not found"));
        }

        if (shipment.status.value !== "label_created") {
          try {
            shipment.createLabel(
              label,
              carrier,
              carrierService,
              trackingNumber,
              this.deps.idGenerator.generate(),
              this.deps.clock.now(),
            );
          } catch (error) {
            if (isDomainError(error)) return err(error);
            throw error;
          }
          await this.deps.shipments.save(shipment, tenantId, tx);
          await notifyBestEffort(this.deps, shipment);
        }
        return ok({ shipmentId: shipment.id.toString(), status: shipment.status.value });
      }),
    );
  }
}

export interface VoidLabelDeps extends ShipmentLifecycleDeps {
  readonly carrierProvider: CarrierProviderPort;
}

interface VoidLabelPrecheck {
  /** Shipment is already `voided` (idempotent resume) — skip the carrier call and return current status as-is. */
  readonly alreadyVoided: boolean;
  readonly labelId: string;
  readonly status: ShipmentStatusValue;
}

/**
 * Voids the shipment's label at the carrier (`CarrierProviderPort.voidLabel`, idempotency-keyed),
 * then transitions to `voided`.
 *
 * Phase A.15 (Shipping, Task 2/2): same transaction-boundary defect and same fix shape as
 * `CreateLabel` above (see its class doc for the full rationale) — the carrier `voidLabel()` call
 * used to run inside the same transaction that read and would persist the shipment; now it runs
 * outside any transaction, between a read-only `precheck` and a `settle` write:
 *   1. `precheck` — 404s if missing, preserves the existing `ValidationError` ("cannot void before
 *      a label exists") shape, short-circuits idempotently if already `voided`, and rejects with the
 *      same `BusinessRuleError` shape `Shipment.transition` would have thrown if the current status
 *      cannot reach `voided`.
 *   2. The carrier `voidLabel()` call, outside any transaction.
 *   3. `settle` — re-reads the shipment (no-op if a concurrent racer already voided it), applies
 *      `voidLabel`, and commits.
 *
 * Carrier-call failure recovery: identical reasoning to `CreateLabel` — `precheck` is a plain read,
 * nothing was reserved, so a thrown carrier error leaves the shipment exactly where it was and is
 * rethrown unchanged.
 */
export class VoidLabel implements UseCase<ShipmentIdInput, ShipmentStatusOutput, DomainError> {
  private readonly deps: VoidLabelDeps;
  private static readonly MAX_CONCURRENCY_RETRIES = 5;

  constructor(deps: VoidLabelDeps) {
    this.deps = deps;
  }

  async execute(input: ShipmentIdInput): Promise<Result<ShipmentStatusOutput, DomainError>> {
    const precheck = await this.precheck(input.shipmentId, input.tenantId);
    if (!precheck.ok) return err(precheck.error);
    if (precheck.value.alreadyVoided) {
      return ok({ shipmentId: input.shipmentId, status: precheck.value.status });
    }
    const { labelId } = precheck.value;

    await this.deps.carrierProvider.voidLabel({
      labelId,
      idempotencyKey: `${input.shipmentId}:void`,
    });

    return this.settle(input.shipmentId, input.tenantId);
  }

  private async precheck(
    shipmentId: string,
    tenantId: string,
  ): Promise<Result<VoidLabelPrecheck, DomainError>> {
    return this.deps.unitOfWork.run<Result<VoidLabelPrecheck, DomainError>>(async (tx) => {
      const shipment = await this.deps.shipments.findById(shipmentId, tenantId, tx);
      if (shipment === null) {
        return err(new NotFoundError("Shipment not found"));
      }
      if (
        shipment.carrier !== undefined &&
        this.deps.isCarrierManaged?.(shipment.carrier.value) === true
      ) {
        return err(
          new CarrierError("CARRIER_USE_CANCEL", "Use the carrier cancel for this shipment", 409),
        );
      }
      if (shipment.label === undefined) {
        return err(new ValidationError("Cannot void a label before one is created", []));
      }

      const status = shipment.status.value;
      if (status === "voided") {
        return ok({ alreadyVoided: true, labelId: shipment.label.labelId, status });
      }
      if (!canTransitionShipment(status, "voided")) {
        return err(
          new BusinessRuleError(`Cannot transition shipment from "${status}" to "voided"`),
        );
      }
      return ok({ alreadyVoided: false, labelId: shipment.label.labelId, status });
    });
  }

  private async settle(
    shipmentId: string,
    tenantId: string,
  ): Promise<Result<ShipmentStatusOutput, DomainError>> {
    return withConcurrencyRetry(VoidLabel.MAX_CONCURRENCY_RETRIES, () =>
      this.deps.unitOfWork.run<Result<ShipmentStatusOutput, DomainError>>(async (tx) => {
        const shipment = await this.deps.shipments.findById(shipmentId, tenantId, tx);
        if (shipment === null) {
          return err(new NotFoundError("Shipment not found"));
        }

        if (shipment.status.value !== "voided") {
          try {
            shipment.voidLabel(this.deps.idGenerator.generate(), this.deps.clock.now());
          } catch (error) {
            if (isDomainError(error)) return err(error);
            throw error;
          }
          await this.deps.shipments.save(shipment, tenantId, tx);
          await notifyBestEffort(this.deps, shipment);
        }
        return ok({ shipmentId: shipment.id.toString(), status: shipment.status.value });
      }),
    );
  }
}

export interface UpdateTrackingInput extends ShipmentIdInput {
  readonly description: string;
  readonly location?: string;
}

export interface UpdateTrackingDeps {
  readonly shipments: ShipmentRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly clock: Clock;
}

/** Appends a carrier tracking scan to the shipment's history (`addTrackingEvent`) — not a status transition, raises `shipping.tracking.updated`. */
export class UpdateTracking implements UseCase<
  UpdateTrackingInput,
  ShipmentStatusOutput,
  DomainError
> {
  private readonly deps: UpdateTrackingDeps;

  constructor(deps: UpdateTrackingDeps) {
    this.deps = deps;
  }

  async execute(input: UpdateTrackingInput): Promise<Result<ShipmentStatusOutput, DomainError>> {
    const description = Guard.againstEmpty(input.description, "description");
    if (!description.ok) return err(description.error);

    return this.deps.unitOfWork.run<Result<ShipmentStatusOutput, DomainError>>(async (tx) => {
      const shipment = await this.deps.shipments.findById(input.shipmentId, input.tenantId, tx);
      if (shipment === null) {
        return err(new NotFoundError("Shipment not found"));
      }

      try {
        shipment.addTrackingEvent(input.description, this.deps.clock.now(), input.location);
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.shipments.save(shipment, input.tenantId, tx);
      return ok({ shipmentId: shipment.id.toString(), status: shipment.status.value });
    });
  }
}

/** Retries a shipment from one of its 3 recoverable states (`rejected`/`delivery_failed`/`exception`) back into the appropriate earlier status. */
export class RetryShipment implements UseCase<ShipmentIdInput, ShipmentStatusOutput, DomainError> {
  private readonly deps: ShipmentLifecycleDeps;

  constructor(deps: ShipmentLifecycleDeps) {
    this.deps = deps;
  }

  async execute(input: ShipmentIdInput): Promise<Result<ShipmentStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<ShipmentStatusOutput, DomainError>>(async (tx) => {
      const shipment = await this.deps.shipments.findById(input.shipmentId, input.tenantId, tx);
      if (shipment === null) {
        return err(new NotFoundError("Shipment not found"));
      }

      try {
        shipment.retry(this.deps.idGenerator.generate(), this.deps.clock.now());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.shipments.save(shipment, input.tenantId, tx);
      await notifyBestEffort(this.deps, shipment);
      return ok({ shipmentId: shipment.id.toString(), status: shipment.status.value });
    });
  }
}
