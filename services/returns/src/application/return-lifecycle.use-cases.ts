import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import {
  ConcurrencyError,
  type DomainError,
  NotFoundError,
  ValidationError,
} from "@platform/utils";
import type { ReturnRequest } from "../domain/return-request";
import type { ReturnRequestRepository } from "../domain/return-request-repository";
import { RefundDecision, type ResolutionOutcome } from "../domain/value-objects/refund-decision";
import { ReturnDisposition } from "../domain/value-objects/return-disposition";
import type { ReturnStatusValue } from "../domain/value-objects/return-status";
import type { ReturnStatusOutput } from "./create-return-request.use-case";
import type {
  InventoryPort,
  NotificationPort,
  OrdersPort,
  PaymentsPort,
  RefundVerificationPort,
  ShippingPort,
} from "./ports";

/**
 * Bounded retry on optimistic-lock conflicts only (Phase A.18, reusing the shape Payments'
 * `withConcurrencyRetry` established in Phase A.4/A.8 — duplicated locally per this codebase's
 * established convention, not shared across packages) — `PrismaReturnRequestRepository.save`
 * throws `ConcurrencyError` when a concurrent writer already advanced the row's `version`; that is
 * expected/recoverable (two racing warehouse callbacks for the same return), so the whole
 * read-check-write attempt is retried from scratch against the now-current row. Any other error
 * (including a Result-channel domain rejection, which is returned not thrown) propagates immediately.
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

export interface ReturnIdInput {
  readonly returnId: string;
}

export interface AdvanceReturnInput extends ReturnIdInput {
  readonly toStatus: ReturnStatusValue;
}

export interface DecideApprovalInput extends ReturnIdInput {
  readonly approved: boolean;
  readonly note?: string;
}

export interface GenerateRmaInput extends ReturnIdInput {
  readonly rmaNumber: string;
}

export interface ReturnLifecycleDeps {
  readonly returns: ReturnRequestRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly ordersPort?: OrdersPort;
  readonly notifications?: NotificationPort;
}

export async function notifyBestEffort(
  deps: ReturnLifecycleDeps,
  returnRequest: ReturnRequest,
): Promise<void> {
  try {
    await deps.ordersPort?.reportReturnOutcome(returnRequest.orderRef, returnRequest.status.value);
    await deps.notifications?.notify(returnRequest.orderRef, returnRequest.status.value);
  } catch {
    // Best-effort: a reference-only notification failure never fails the transition's own result.
  }
}

/** Generic validated transition — moves a return request to any status its current status's transition table allows, then fans out Orders/Notifications best-effort. */
export class AdvanceReturn implements UseCase<AdvanceReturnInput, ReturnStatusOutput, DomainError> {
  private readonly deps: ReturnLifecycleDeps;

  constructor(deps: ReturnLifecycleDeps) {
    this.deps = deps;
  }

  async execute(input: AdvanceReturnInput): Promise<Result<ReturnStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<ReturnStatusOutput, DomainError>>(async (tx) => {
      const returnRequest = await this.deps.returns.findById(input.returnId, tx);
      if (returnRequest === null) {
        return err(new NotFoundError("Return request not found"));
      }

      try {
        returnRequest.transition(
          input.toStatus,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.returns.save(returnRequest, tx);
      await notifyBestEffort(this.deps, returnRequest);
      return ok({ returnId: returnRequest.id.toString(), status: returnRequest.status.value });
    });
  }
}

/** Approves or rejects a return request. */
export class DecideApproval implements UseCase<
  DecideApprovalInput,
  ReturnStatusOutput,
  DomainError
> {
  private readonly deps: ReturnLifecycleDeps;

  constructor(deps: ReturnLifecycleDeps) {
    this.deps = deps;
  }

  async execute(input: DecideApprovalInput): Promise<Result<ReturnStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<ReturnStatusOutput, DomainError>>(async (tx) => {
      const returnRequest = await this.deps.returns.findById(input.returnId, tx);
      if (returnRequest === null) {
        return err(new NotFoundError("Return request not found"));
      }

      try {
        if (input.approved) {
          returnRequest.approve(
            this.deps.idGenerator.generate(),
            this.deps.clock.now(),
            input.note,
          );
        } else {
          returnRequest.reject(this.deps.idGenerator.generate(), this.deps.clock.now(), input.note);
        }
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.returns.save(returnRequest, tx);
      await notifyBestEffort(this.deps, returnRequest);
      return ok({ returnId: returnRequest.id.toString(), status: returnRequest.status.value });
    });
  }
}

/** Generates the RMA number for an approved return and transitions to `rma_generated`. */
export class GenerateRma implements UseCase<GenerateRmaInput, ReturnStatusOutput, DomainError> {
  private readonly deps: ReturnLifecycleDeps;

  constructor(deps: ReturnLifecycleDeps) {
    this.deps = deps;
  }

  async execute(input: GenerateRmaInput): Promise<Result<ReturnStatusOutput, DomainError>> {
    const rmaNumber = Guard.againstEmpty(input.rmaNumber, "rmaNumber");
    if (!rmaNumber.ok) return err(rmaNumber.error);

    return this.deps.unitOfWork.run<Result<ReturnStatusOutput, DomainError>>(async (tx) => {
      const returnRequest = await this.deps.returns.findById(input.returnId, tx);
      if (returnRequest === null) {
        return err(new NotFoundError("Return request not found"));
      }

      try {
        returnRequest.generateRma(
          input.rmaNumber,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.returns.save(returnRequest, tx);
      await notifyBestEffort(this.deps, returnRequest);
      return ok({ returnId: returnRequest.id.toString(), status: returnRequest.status.value });
    });
  }
}

export interface ReceivePackageInput extends ReturnIdInput {
  readonly source: string;
  readonly callbackId: string;
}

export interface ReceivePackageOutput extends ReturnStatusOutput {
  readonly duplicate: boolean;
}

export interface ReceivePackageDeps extends ReturnLifecycleDeps {
  readonly shippingPort: ShippingPort;
}

/**
 * Verifies the return shipment with Shipping (`ShippingPort.verifyReturnShipment`), then records a
 * replay-safe warehouse callback and transitions to `package_received`.
 *
 * Phase A.18 (Task 7/9, dedup-store transaction-boundary hardening): the dedup check used to be a
 * separate `ProcessedWarehouseCallbackStore` whose `markProcessed()` write had no `tx` parameter —
 * it could not commit atomically with `returns.save()` (A.17 §14). Fixed by Option B (Task 7): the
 * dedup signal is now derived directly from `returnRequest.attempts` — the SAME `findById(tx)` read
 * and SAME `save(returnRequest, tx)` write already used for the rest of the aggregate, matching this
 * codebase's own `Coupons`/`Loyalty` aggregates. "Processed" is now a committed row in the return's
 * own attempt log, so a dedup marker can never survive a rolled-back write (Scenario C) and can
 * never be lost while the aggregate write survives (Scenario B) — both are literally the same write.
 *
 * Unlike Automation's `TriggerWorkflow.dispatch()`, `ShippingPort.verifyReturnShipment()` is
 * documented as reference-only/read-only (returns a boolean, mutates nothing on the Shipping side)
 * — so, unlike Automation, this fix deliberately does NOT also split the call out of the open
 * transaction into a separate reserve/settle pair: there is no mutating external side effect to
 * duplicate, only a redundant read, which is an accepted, low-severity residual (documented in the
 * final report, not fixed — introducing a new durable intermediate `ReturnStatus` purely to move a
 * read-only call outside the tx would be exactly the "new infrastructure it doesn't need" this
 * phase's Absolute Constraints forbid speculatively adding).
 */
export class ReceivePackage implements UseCase<
  ReceivePackageInput,
  ReceivePackageOutput,
  DomainError
> {
  private static readonly MAX_CONCURRENCY_RETRIES = 5;
  private readonly deps: ReceivePackageDeps;

  constructor(deps: ReceivePackageDeps) {
    this.deps = deps;
  }

  async execute(input: ReceivePackageInput): Promise<Result<ReceivePackageOutput, DomainError>> {
    const source = Guard.againstEmpty(input.source, "source");
    if (!source.ok) return err(source.error);
    const callbackId = Guard.againstEmpty(input.callbackId, "callbackId");
    if (!callbackId.ok) return err(callbackId.error);

    const callbackReference = `${input.source}:${input.callbackId}`;

    return withConcurrencyRetry(ReceivePackage.MAX_CONCURRENCY_RETRIES, () =>
      this.deps.unitOfWork.run<Result<ReceivePackageOutput, DomainError>>(async (tx) => {
        const returnRequest = await this.deps.returns.findById(input.returnId, tx);
        if (returnRequest === null) {
          return err(new NotFoundError("Return request not found"));
        }

        const alreadyProcessed = returnRequest.attempts.some(
          (a) =>
            a.kind === "warehouse_callback" &&
            a.outcome === "succeeded" &&
            a.reference === callbackReference,
        );
        if (alreadyProcessed) {
          return ok({
            returnId: returnRequest.id.toString(),
            status: returnRequest.status.value,
            duplicate: true,
          });
        }

        const verified = await this.deps.shippingPort.verifyReturnShipment(returnRequest.orderRef);
        if (!verified) {
          return err(new ValidationError("Return shipment could not be verified", []));
        }

        try {
          returnRequest.recordWarehouseCallback(this.deps.clock.now(), callbackReference);
          returnRequest.receivePackage(this.deps.idGenerator.generate(), this.deps.clock.now());
        } catch (error) {
          if (isDomainError(error)) return err(error);
          throw error;
        }

        await this.deps.returns.save(returnRequest, tx);
        await notifyBestEffort(this.deps, returnRequest);
        return ok({
          returnId: returnRequest.id.toString(),
          status: returnRequest.status.value,
          duplicate: false,
        });
      }),
    );
  }
}

export interface InspectItemsInput extends ReturnIdInput {
  readonly itemRef: string;
  readonly passed: boolean;
  readonly note?: string;
}

/** Records one item's inspection result — idempotent by `itemRef` (the domain method itself is a no-op for a repeat itemRef; no re-transition once inspection is already completed). */
export class InspectItems implements UseCase<InspectItemsInput, ReturnStatusOutput, DomainError> {
  private readonly deps: ReturnLifecycleDeps;

  constructor(deps: ReturnLifecycleDeps) {
    this.deps = deps;
  }

  async execute(input: InspectItemsInput): Promise<Result<ReturnStatusOutput, DomainError>> {
    const itemRef = Guard.againstEmpty(input.itemRef, "itemRef");
    if (!itemRef.ok) return err(itemRef.error);

    return this.deps.unitOfWork.run<Result<ReturnStatusOutput, DomainError>>(async (tx) => {
      const returnRequest = await this.deps.returns.findById(input.returnId, tx);
      if (returnRequest === null) {
        return err(new NotFoundError("Return request not found"));
      }
      if (returnRequest.status.value === "inspection_completed") {
        return ok({ returnId: returnRequest.id.toString(), status: returnRequest.status.value });
      }

      try {
        returnRequest.inspectItem(input.itemRef, input.passed, this.deps.clock.now(), input.note);
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.returns.save(returnRequest, tx);
      return ok({ returnId: returnRequest.id.toString(), status: returnRequest.status.value });
    });
  }
}

export interface AcceptItemsItemInput {
  readonly orderItemRef: string;
  readonly disposition: string;
}

export interface AcceptItemsInput extends ReturnIdInput {
  readonly items: readonly AcceptItemsItemInput[];
}

export interface AcceptItemsDeps extends ReturnLifecycleDeps {
  readonly inventoryPort: InventoryPort;
}

/** Records each accepted item's disposition, transitions to `items_accepted`, then requests a restock for `restock`-dispositioned items via `InventoryPort` — Returns never moves inventory itself. */
export class AcceptItems implements UseCase<AcceptItemsInput, ReturnStatusOutput, DomainError> {
  private readonly deps: AcceptItemsDeps;

  constructor(deps: AcceptItemsDeps) {
    this.deps = deps;
  }

  async execute(input: AcceptItemsInput): Promise<Result<ReturnStatusOutput, DomainError>> {
    const dispositions: { orderItemRef: string; disposition: ReturnDisposition }[] = [];
    for (const itemInput of input.items) {
      const disposition = ReturnDisposition.create(itemInput.disposition);
      if (!disposition.ok) return err(disposition.error);
      dispositions.push({ orderItemRef: itemInput.orderItemRef, disposition: disposition.value });
    }

    return this.deps.unitOfWork.run<Result<ReturnStatusOutput, DomainError>>(async (tx) => {
      const returnRequest = await this.deps.returns.findById(input.returnId, tx);
      if (returnRequest === null) {
        return err(new NotFoundError("Return request not found"));
      }

      try {
        returnRequest.acceptItems(
          dispositions,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.returns.save(returnRequest, tx);

      const restockItems = returnRequest.items
        .filter((item) => item.disposition?.value === "restock")
        .map((item) => ({ productRef: item.productRef.value, quantity: item.quantity }));
      if (restockItems.length > 0) {
        try {
          await this.deps.inventoryPort.restock(returnRequest.orderRef, restockItems);
        } catch {
          // Best-effort: a reference-only restock failure never fails the acceptance's own result.
        }
      }

      await notifyBestEffort(this.deps, returnRequest);
      return ok({ returnId: returnRequest.id.toString(), status: returnRequest.status.value });
    });
  }
}

export interface DecideResolutionInput extends ReturnIdInput {
  readonly outcome: ResolutionOutcome;
  readonly amountMinor?: number;
  readonly currency?: string;
}

export interface DecideResolutionDeps extends ReturnLifecycleDeps {
  readonly paymentsPort: PaymentsPort;
  /**
   * Gates a staff-decided refund amount against the order's refundable ceiling (Phase A.1, F-04).
   * Optional: when unwired, behavior is unchanged from before this field existed — same convention
   * as Orders' `paymentVerification` (Sprint A1 Task 5).
   */
  readonly refundVerification?: RefundVerificationPort;
}

/**
 * Records the chosen resolution (refund/replacement/repair) and transitions accordingly. For
 * `refund`, requests it from Payments (`PaymentsPort.requestRefund`, retry-safe idempotency key)
 * after an optional `RefundVerificationPort` check — Returns itself never calculates the
 * refundable amount, only bounds the caller-provided one against it.
 *
 * Phase A.13.1 (Returns refund transaction-boundary closure): the resolution decision (the
 * `refund_requested`/`replacement_requested`/`repair_requested` transition and its persistence)
 * is committed in its own transaction BEFORE `PaymentsPort.requestRefund` is ever called. Pre-fix,
 * the whole call — including the nested Payments reserve/PSP-call/settle chain and the live Stripe
 * HTTP round-trip — ran inside this use case's own open Prisma transaction, holding a DB connection
 * for the full external-call duration. `requestRefund` (and the PSP call it makes) is unchanged
 * internally (Phase A.4's reserve → PSP → settle split already keeps ITS OWN transactions short);
 * only the point at which Returns invokes it moved from "inside my transaction" to "after my
 * transaction has committed". See PHASE_A13_1_RETURNS_REFUND_TRANSACTION_BOUNDARY_CLOSURE_REPORT.md.
 */
export class DecideResolution implements UseCase<
  DecideResolutionInput,
  ReturnStatusOutput,
  DomainError
> {
  private readonly deps: DecideResolutionDeps;

  constructor(deps: DecideResolutionDeps) {
    this.deps = deps;
  }

  async execute(input: DecideResolutionInput): Promise<Result<ReturnStatusOutput, DomainError>> {
    const decision = RefundDecision.create(input.outcome, input.amountMinor, input.currency);
    if (!decision.ok) return err(decision.error);

    // Narrowed once, reused both inside the transaction (eligibility check) and after it commits
    // (the actual refund request) — `RefundDecision.create` above already guarantees these are
    // defined whenever `input.outcome === "refund"`, so this is the same condition as before,
    // just evaluated once instead of twice.
    const refundRequest =
      input.outcome === "refund" && input.amountMinor !== undefined && input.currency !== undefined
        ? { amountMinor: input.amountMinor, currency: input.currency }
        : undefined;

    const committed = await this.deps.unitOfWork.run<Result<ReturnRequest, DomainError>>(
      async (tx) => {
        const returnRequest = await this.deps.returns.findById(input.returnId, tx);
        if (returnRequest === null) {
          return err(new NotFoundError("Return request not found"));
        }

        if (refundRequest !== undefined && this.deps.refundVerification !== undefined) {
          const refundable = await this.deps.refundVerification.isRefundable(
            returnRequest.orderRef,
            refundRequest.amountMinor,
            refundRequest.currency,
          );
          if (!refundable) {
            return err(
              new ValidationError("Refund amount exceeds the refundable amount for this order", [
                { field: "amountMinor", message: "could not be verified against Payments/Orders" },
              ]),
            );
          }
        }

        try {
          returnRequest.decideResolution(
            decision.value,
            this.deps.idGenerator.generate(),
            this.deps.clock.now(),
          );
        } catch (error) {
          if (isDomainError(error)) return err(error);
          throw error;
        }

        await this.deps.returns.save(returnRequest, tx);

        // Non-refund outcomes have no external call left to make — notify now, exactly as before
        // this phase (unchanged code path, still inside the transaction).
        if (refundRequest === undefined) {
          await notifyBestEffort(this.deps, returnRequest);
        }

        return ok(returnRequest);
      },
    );

    if (!committed.ok) return committed;
    const returnRequest = committed.value;

    if (refundRequest !== undefined) {
      // Outside the transaction: the resolution decision above is already durably committed, so a
      // PSP failure here never rolls it back — it lands as a thrown/rejected error (unchanged
      // contract: callers still see `execute()` reject, same as pre-fix), while Payments' own
      // `settle()` (inside `requestRefund`) independently records the failed refund and frees
      // `remaining()` capacity for a retry (see the Phase A.4/A.5 mechanisms this reuses unchanged).
      await this.deps.paymentsPort.requestRefund(
        returnRequest.orderRef,
        refundRequest.amountMinor,
        refundRequest.currency,
        `${returnRequest.id.toString()}:refund`,
      );
      await notifyBestEffort(this.deps, returnRequest);
    }

    return ok({ returnId: returnRequest.id.toString(), status: returnRequest.status.value });
  }
}
