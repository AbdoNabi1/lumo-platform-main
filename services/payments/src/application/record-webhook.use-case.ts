import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { Guard, isDomainError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError } from "@platform/utils";
import type { PaymentIntentRepository } from "../domain/payment-intent-repository";
import type { PaymentStatusValue } from "../domain/value-objects/payment-status";
import type { ProcessedWebhookStore } from "./ports";

export interface RecordWebhookInput {
  /** ADR-0014 (WP-10, T10.3): per-call tenant scope. */
  readonly tenantId: string;
  readonly paymentIntentId: string;
  readonly provider: string;
  readonly eventId: string;
  readonly kind: string;
}

export interface RecordWebhookOutput {
  readonly paymentIntentId: string;
  readonly status: string;
  readonly duplicate: boolean;
}

/**
 * Phase A.9 (capture crash-recovery/reconciliation closure). The minimal shape of
 * `CapturePaymentLifecycle.settle` — structurally typed here rather than importing the whole
 * lifecycle class, so this file stays decoupled from Capture's own use case. Any object with a
 * matching `settle` method satisfies this without an explicit `implements`.
 */
export interface CaptureSettlementPort {
  settle(
    paymentIntentId: string,
    tenantId: string,
  ): Promise<Result<{ readonly paymentIntentId: string; readonly status: string }, DomainError>>;
}

export interface RecordWebhookDeps {
  readonly intents: PaymentIntentRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly processedWebhooks: ProcessedWebhookStore;
  /**
   * Phase A.9. When present, a webhook `kind` mapping to `captured` settles THROUGH the exact same
   * code path a normal client retry uses (`CapturePaymentLifecycle.settle` — Charge creation,
   * best-effort Orders/Notifications, Finance recording), instead of only advancing `status` via the
   * generic `transition()` below. Optional and additive: composition roots that do not wire it keep
   * the pre-A.9 status-only webhook behavior for `captured` unchanged (`execute()`'s fallback
   * branch) — this closes the crash-recovery gap only where a caller opts in, no breaking change.
   */
  readonly captureSettlement?: CaptureSettlementPort;
}

/** Webhook kinds that map directly onto a validated lifecycle transition (Sprint 4.8). Unrecognized kinds are still recorded, just don't transition. */
const KIND_TO_STATUS: Readonly<Record<string, PaymentStatusValue>> = {
  authorized: "authorized",
  captured: "captured",
  failed: "failed",
  cancelled: "cancelled",
  expired: "expired",
};

/** Records a PSP webhook idempotently (`ProcessedWebhookStore`, replay-safe) and maps its kind to a validated transition. */
export class RecordWebhook implements UseCase<
  RecordWebhookInput,
  RecordWebhookOutput,
  DomainError
> {
  private readonly deps: RecordWebhookDeps;

  constructor(deps: RecordWebhookDeps) {
    this.deps = deps;
  }

  async execute(input: RecordWebhookInput): Promise<Result<RecordWebhookOutput, DomainError>> {
    const provider = Guard.againstEmpty(input.provider, "provider");
    if (!provider.ok) return err(provider.error);
    const eventId = Guard.againstEmpty(input.eventId, "eventId");
    if (!eventId.ok) return err(eventId.error);

    const toStatus = KIND_TO_STATUS[input.kind];
    const captureSettlement = this.deps.captureSettlement;
    // Phase A.9: a `captured` event with a settlement capability wired defers the actual
    // captured-transition + Charge/notify/Finance side effects to `captureSettlement.settle()`
    // (see below) instead of the generic bare-status `transition()` this loop otherwise uses.
    const deferToCaptureSettlement = toStatus === "captured" && captureSettlement !== undefined;

    const recorded = await this.deps.unitOfWork.run<
      Result<
        { readonly paymentIntentId: string; readonly duplicate: boolean; readonly status: string },
        DomainError
      >
    >(async (tx) => {
      // Phase A.10 (Tasks 4-6): `input.paymentIntentId` is NOT always our own domain id — a real
      // Stripe webhook's `data.object.id` is Stripe's OWN PaymentIntent reference
      // (`payments-webhook-routes.ts`), which only ever lands on our aggregate as `pspReference`
      // (set by `AuthorizePayment`), never as `id`. Try the domain id first (existing callers —
      // e.g. this repo's own test fixtures, and any future non-Stripe provider that DOES key by our
      // id — are unaffected), then fall back to the PSP reference so a genuine Stripe webhook
      // actually correlates to its intent instead of failing closed with a false "not found". The
      // RESOLVED domain id (`intent.id`, never the caller-supplied `input.paymentIntentId` verbatim)
      // is what every downstream step — `captureSettlement.settle()`, the response body — must use.
      const intent =
        (await this.deps.intents.findById(input.paymentIntentId, input.tenantId, tx)) ??
        (await this.deps.intents.findByPspReference(input.paymentIntentId, input.tenantId, tx));
      if (intent === null) {
        return err(new NotFoundError("Payment intent not found"));
      }
      const paymentIntentId = intent.id.toString();

      const alreadyProcessed = await this.deps.processedWebhooks.hasProcessed(
        input.provider,
        input.eventId,
        input.tenantId,
      );
      if (alreadyProcessed) {
        return ok({ paymentIntentId, duplicate: true, status: intent.status.value });
      }

      try {
        intent.recordWebhook(
          input.provider,
          input.kind,
          this.deps.idGenerator.generate(),
          this.deps.clock.now(),
        );
        // Phase A.11 (Task 11 — webhook ordering): `ProcessedWebhookStore` dedups on `(tenant, provider,
        // eventId)` only, so a genuinely DISTINCT Stripe event (different eventId — e.g. a second
        // `payment_intent.payment_failed` for a second failed attempt) that maps to the SAME status
        // the intent has already reached must not be forced through `transition()` — the
        // status-transition table has no self-transition for any status (by design: a self-loop is
        // not a "move"), so re-presenting an already-reached target status is not a new transition
        // to reject, it is a webhook to just record. This mirrors the no-op guard
        // `CapturePaymentLifecycle.settle()` already applies for `captured` via `alreadyCaptured`
        // (`payment-lifecycle.use-cases.ts`) — `captured` itself never reaches this line in
        // production (`deferToCaptureSettlement` is always wired), but `authorized`/`failed`/
        // `cancelled`/`expired` do. A genuinely illegal cross-status webhook (current status differs
        // from `toStatus` and the transition table forbids it) is unaffected and still rejected below.
        if (
          toStatus !== undefined &&
          !deferToCaptureSettlement &&
          intent.status.value !== toStatus
        ) {
          intent.transition(toStatus, this.deps.idGenerator.generate(), this.deps.clock.now());
        }
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }

      await this.deps.intents.save(intent, input.tenantId, tx);
      if (!deferToCaptureSettlement) {
        // Marked processed here, in the same step that fully handled the event. When deferring,
        // marking happens only after `captureSettlement.settle()` below actually succeeds — a
        // webhook whose settlement step fails (or never runs, crash) must remain replayable.
        await this.deps.processedWebhooks.markProcessed(
          input.provider,
          input.eventId,
          input.tenantId,
        );
      }
      return ok({ paymentIntentId, duplicate: false, status: intent.status.value });
    });

    if (!recorded.ok) return err(recorded.error);
    if (recorded.value.duplicate) {
      return ok({
        paymentIntentId: recorded.value.paymentIntentId,
        status: recorded.value.status,
        duplicate: true,
      });
    }
    if (!deferToCaptureSettlement) {
      return ok({
        paymentIntentId: recorded.value.paymentIntentId,
        status: recorded.value.status,
        duplicate: false,
      });
    }

    // The webhook receipt is durably recorded (above); now settle THROUGH the same code a normal
    // client retry uses. `settle()` is itself idempotent (a concurrent/duplicate settle is a safe
    // no-op) and runs in its own committed transaction, deliberately separate from the receipt.
    // `captureSettlement` is guaranteed defined here — `deferToCaptureSettlement` is only true when it is.
    // Uses the RESOLVED domain id (Phase A.10), not `input.paymentIntentId` — `settle()` looks up by
    // `findById` only, so passing Stripe's own reference here would fail the same way `RecordWebhook`
    // itself used to before this phase's fix.
    const settled = await captureSettlement.settle(recorded.value.paymentIntentId, input.tenantId);
    if (!settled.ok) return err(settled.error);

    await this.deps.processedWebhooks.markProcessed(input.provider, input.eventId, input.tenantId);
    return ok({
      paymentIntentId: recorded.value.paymentIntentId,
      status: settled.value.status,
      duplicate: false,
    });
  }
}
