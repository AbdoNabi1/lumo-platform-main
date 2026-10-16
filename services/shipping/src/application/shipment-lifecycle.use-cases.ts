import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { BusinessRuleError, Guard, isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import {
  ConcurrencyError,
  type DomainError,
  NotFoundError,
  ValidationError,
} from "@platform/utils";
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
import type { CarrierProviderPort, FulfillmentPort, NotificationPort } from "./ports";

/**
 * Bounded retry on optimistic-lock conflicts only (Phase A.15, reusing the shape Payments'
 * `withConcurrencyRetry` established in Phase A.4/A.8, duplicated per-context by convention).
 * `PrismaShipmentRepository.save` throws `ConcurrencyError` when a concurrent writer already
 * advanced the row's `version` — that is expected/recoverable (two racing label/void attempts for
 * the same shipment), so the read-check-write attempt is retried from scratch against the
 * now-current row. Any other error propagates immediately.
 */
async function withConcurrencyRetry<T>(maxAttempts: number, attempt: () => Promise<T>): Promise<T> {
  for (let i = 1; i <= maxAttempts; i += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (!(error instanceof ConcurrencyError) || i === maxAttempts) {
        throw error;
      }
    }
  }
  throw new Error("unreachable");
}

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

export interface CreateLabelDeps extends ShipmentLifecycleDeps {
  readonly carrierProvider: CarrierProviderPort;
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
export class CreateLabel implements UseCase<ShipmentIdInput, ShipmentStatusOutput, DomainError> {
  private readonly deps: CreateLabelDeps;
  private static readonly MAX_CONCURRENCY_RETRIES = 5;

  constructor(deps: CreateLabelDeps) {
    this.deps = deps;
  }

  async execute(input: ShipmentIdInput): Promise<Result<ShipmentStatusOutput, DomainError>> {
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

  private async precheck(
    shipmentId: string,
    tenantId: string,
  ): Promise<Result<CreateLabelPrecheck, DomainError>> {
    return this.deps.unitOfWork.run<Result<CreateLabelPrecheck, DomainError>>(async (tx) => {
      const shipment = await this.deps.shipments.findById(shipmentId, tenantId, tx);
      if (shipment === null) {
        return err(new NotFoundError("Shipment not found"));
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
