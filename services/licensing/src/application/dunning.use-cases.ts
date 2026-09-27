import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { BusinessRuleError } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError, isDomainError } from "@platform/utils";
import type { InvoiceRepository, SubscriptionRepository } from "../domain/repositories";
import type { Subscription } from "../domain/subscription";
import type { CollectInvoice, IssueInvoice } from "./billing.use-cases";

/**
 * T14.5 (dunning) — the retry schedule and grace period. `retryIntervalsDays[i]` is the number of
 * days after the PREVIOUS attempt (attempt `i`, 0-indexed — entering grace counts as attempt 0's
 * scheduling) before attempt `i + 1` runs; its length must equal `maxAttempts` (asserted by
 * {@link buildDunningPolicy}, not by convention). `gracePeriodDays` is informational only — it is
 * what {@link Subscription.enterGrace} records — and is the exhaustion date (`sum(retryIntervalsDays)`
 * unless deliberately widened, e.g. a legal/comms review margin the operator decides).
 *
 * These numbers are a deliberately plain, defensible default (not a discovered product spec) chosen
 * so the state machine can be exercised end to end — the same "placeholder policy, not a discovered
 * spec" caveat `DEFAULT_FINANCE_POSTING_ACCOUNTS`/`pointsForPaidOrder` already carry elsewhere in
 * this codebase for exactly this reason.
 */
export interface DunningPolicy {
  readonly maxAttempts: number;
  readonly retryIntervalsDays: readonly number[];
  readonly gracePeriodDays: number;
}

export const DEFAULT_DUNNING_POLICY: DunningPolicy = {
  maxAttempts: 3,
  retryIntervalsDays: [1, 3, 7],
  gracePeriodDays: 7,
};

function buildPolicy(policy?: DunningPolicy): DunningPolicy {
  const resolved = policy ?? DEFAULT_DUNNING_POLICY;
  if (resolved.retryIntervalsDays.length !== resolved.maxAttempts) {
    throw new Error(
      `DunningPolicy.retryIntervalsDays must have exactly maxAttempts (${resolved.maxAttempts}) entries, got ${resolved.retryIntervalsDays.length}`,
    );
  }
  return resolved;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** `buildPolicy` already asserts `retryIntervalsDays.length === maxAttempts`, so `index < maxAttempts` is always in range. */
function retryIntervalDays(policy: DunningPolicy, index: number): number {
  const days = policy.retryIntervalsDays[index];
  if (days === undefined) {
    throw new Error(`DunningPolicy.retryIntervalsDays has no entry at index ${index}`);
  }
  return days;
}

export interface DunningDeps {
  readonly subscriptions: SubscriptionRepository;
  readonly invoices: InvoiceRepository;
  readonly issueInvoice: IssueInvoice;
  readonly collectInvoice: CollectInvoice;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly policy?: DunningPolicy;
}

export interface EnterDunningInput {
  readonly subscriptionId: string;
  readonly invoiceId: string;
  readonly tenantId: string;
}

export interface SubscriptionStatusOutput {
  readonly subscriptionId: string;
  readonly status: Subscription["status"];
}

/**
 * T14.5 — detection: a renewal charge just failed (`BillSubscriptionRenewal` returned `status:
 * "failed"`). Moves the subscription `active -> grace` (via the existing {@link Subscription.enterGrace},
 * already a published event) and schedules the first dunning retry. Idempotent: a re-run for the
 * SAME failed invoice (a crashed/retried scheduler tick) is a no-op, not a second `entered_grace`
 * event — `enterGrace` has no `grace -> grace` transition, so re-entering would otherwise throw.
 */
export class EnterDunning implements UseCase<
  EnterDunningInput,
  SubscriptionStatusOutput,
  DomainError
> {
  private readonly deps: DunningDeps;
  private readonly policy: DunningPolicy;

  constructor(deps: DunningDeps) {
    this.deps = deps;
    this.policy = buildPolicy(deps.policy);
  }

  async execute(input: EnterDunningInput): Promise<Result<SubscriptionStatusOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<SubscriptionStatusOutput, DomainError>>(async (tx) => {
      const subscription = await this.deps.subscriptions.findById(
        input.subscriptionId,
        input.tenantId,
        tx,
      );
      if (subscription === null) return err(new NotFoundError("Subscription not found"));

      if (subscription.status === "grace") {
        // Idempotent resume: the same failed invoice already opened dunning.
        if (subscription.retryPolicy?.invoiceRef === input.invoiceId) {
          return ok({ subscriptionId: input.subscriptionId, status: subscription.status });
        }
        return err(
          new BusinessRuleError(
            `Subscription ${input.subscriptionId} is already in grace for a different invoice`,
          ),
        );
      }
      if (subscription.status !== "active") {
        return err(
          new BusinessRuleError(`Cannot enter dunning from a ${subscription.status} subscription`),
        );
      }

      const now = this.deps.clock.now();
      try {
        subscription.enterGrace(this.policy.gracePeriodDays, this.deps.idGenerator.generate(), now);
        subscription.setRetryPolicy({
          maxAttempts: this.policy.maxAttempts,
          attempt: 0,
          nextRetryAt: new Date(now.getTime() + retryIntervalDays(this.policy, 0) * DAY_MS),
          invoiceRef: input.invoiceId,
        });
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
      await this.deps.subscriptions.save(subscription, input.tenantId, tx);
      return ok({ subscriptionId: input.subscriptionId, status: subscription.status });
    });
  }
}

export interface RetryDunningInvoiceInput {
  readonly subscriptionId: string;
  readonly tenantId: string;
}

export type DunningRetryOutcome = "recovered" | "retry_scheduled" | "exhausted";

export interface RetryDunningInvoiceOutput {
  readonly subscriptionId: string;
  readonly invoiceId: string;
  readonly outcome: DunningRetryOutcome;
  readonly status: Subscription["status"];
}

/**
 * T14.5 — the retry schedule itself: re-issues the failed invoice (`failed -> issued`, the existing
 * `IssueInvoice`) and collects it again (the existing, idempotency-keyed `CollectInvoice` — the
 * double-charge protection is entirely inherited from there, see that class's doc comment). Three
 * outcomes, each its own state transition on the existing machine:
 *  - **recovered** — the charge succeeded: `grace -> active` via {@link Subscription.recoverFromGrace},
 *    retry schedule cleared.
 *  - **retry_scheduled** — the charge failed again and attempts remain: stays in `grace`, the next
 *    `nextRetryAt` is pushed out per the policy.
 *  - **exhausted** — the charge failed and the policy's `maxAttempts` is used up: `grace -> expired`
 *    via {@link Subscription.exhaustDunning}, retry schedule cleared.
 *
 * Crash-recovery / idempotent resume: if the invoice is already `paid` (a previous call's collect
 * succeeded but the subscription mutation that follows it never committed) this reports `recovered`
 * without calling `payments.collect()` again. If the invoice is already `issued` (a previous call's
 * re-issue committed but its collect crashed before completing) this skips straight to `collectInvoice`
 * instead of re-issuing, which would otherwise throw (`issued -> issued` is not a valid transition).
 */
export class RetryDunningInvoice implements UseCase<
  RetryDunningInvoiceInput,
  RetryDunningInvoiceOutput,
  DomainError
> {
  private readonly deps: DunningDeps;
  private readonly policy: DunningPolicy;

  constructor(deps: DunningDeps) {
    this.deps = deps;
    this.policy = buildPolicy(deps.policy);
  }

  async execute(
    input: RetryDunningInvoiceInput,
  ): Promise<Result<RetryDunningInvoiceOutput, DomainError>> {
    const subscription = await this.deps.subscriptions.findById(
      input.subscriptionId,
      input.tenantId,
    );
    if (subscription === null) return err(new NotFoundError("Subscription not found"));
    if (subscription.status === "active") {
      // Idempotent resume: a racing call already completed the recovery.
      return ok({
        subscriptionId: input.subscriptionId,
        invoiceId: subscription.retryPolicy?.invoiceRef ?? "",
        outcome: "recovered",
        status: subscription.status,
      });
    }
    if (subscription.status !== "grace" || subscription.retryPolicy?.invoiceRef === undefined) {
      return err(
        new BusinessRuleError(
          `Subscription ${input.subscriptionId} has no dunning retry to run (status: ${subscription.status})`,
        ),
      );
    }
    const invoiceId = subscription.retryPolicy.invoiceRef;
    const attempt = subscription.retryPolicy.attempt;

    const invoice = await this.deps.invoices.findById(invoiceId, input.tenantId);
    if (invoice === null) return err(new NotFoundError("Invoice not found"));
    if (invoice.status === "failed") {
      const issued = await this.deps.issueInvoice.execute({ invoiceId, tenantId: input.tenantId });
      if (!issued.ok) return err(issued.error);
    } else if (invoice.status !== "issued" && invoice.status !== "paid") {
      return err(
        new BusinessRuleError(`Cannot retry dunning: invoice ${invoiceId} is ${invoice.status}`),
      );
    }

    try {
      const collected = await this.deps.collectInvoice.execute({
        invoiceId,
        tenantId: input.tenantId,
      });
      if (!collected.ok) return err(collected.error);
      return this.recover(input.subscriptionId, input.tenantId, invoiceId);
    } catch (error) {
      const reread = await this.deps.invoices.findById(invoiceId, input.tenantId);
      if (reread?.status !== "failed") throw error;
      return this.rescheduleOrExhaust(input.subscriptionId, input.tenantId, invoiceId, attempt);
    }
  }

  private async recover(
    subscriptionId: string,
    tenantId: string,
    invoiceId: string,
  ): Promise<Result<RetryDunningInvoiceOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<RetryDunningInvoiceOutput, DomainError>>(async (tx) => {
      const subscription = await this.deps.subscriptions.findById(subscriptionId, tenantId, tx);
      if (subscription === null) return err(new NotFoundError("Subscription not found"));
      if (subscription.status === "grace") {
        subscription.recoverFromGrace(this.deps.idGenerator.generate(), this.deps.clock.now());
        subscription.setRetryPolicy(undefined);
        await this.deps.subscriptions.save(subscription, tenantId, tx);
      }
      return ok({
        subscriptionId,
        invoiceId,
        outcome: "recovered",
        status: subscription.status,
      });
    });
  }

  private async rescheduleOrExhaust(
    subscriptionId: string,
    tenantId: string,
    invoiceId: string,
    attempt: number,
  ): Promise<Result<RetryDunningInvoiceOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<RetryDunningInvoiceOutput, DomainError>>(async (tx) => {
      const subscription = await this.deps.subscriptions.findById(subscriptionId, tenantId, tx);
      if (subscription === null) return err(new NotFoundError("Subscription not found"));
      if (subscription.status !== "grace") {
        // Already resolved by a racer (recovered or exhausted) — report the current state, not an error.
        return ok({
          subscriptionId,
          invoiceId,
          outcome: subscription.status === "expired" ? "exhausted" : "recovered",
          status: subscription.status,
        });
      }

      const now = this.deps.clock.now();
      const currentAttempt = subscription.retryPolicy?.attempt ?? attempt;
      const nextAttempt = currentAttempt + 1;
      if (nextAttempt >= this.policy.maxAttempts) {
        subscription.exhaustDunning(this.deps.idGenerator.generate(), now);
        subscription.setRetryPolicy(undefined);
        await this.deps.subscriptions.save(subscription, tenantId, tx);
        return ok({ subscriptionId, invoiceId, outcome: "exhausted", status: subscription.status });
      }

      subscription.setRetryPolicy({
        maxAttempts: this.policy.maxAttempts,
        attempt: nextAttempt,
        nextRetryAt: new Date(now.getTime() + retryIntervalDays(this.policy, nextAttempt) * DAY_MS),
        invoiceRef: invoiceId,
      });
      await this.deps.subscriptions.save(subscription, tenantId, tx);
      return ok({
        subscriptionId,
        invoiceId,
        outcome: "retry_scheduled",
        status: subscription.status,
      });
    });
  }
}

export interface ListDueInput {
  readonly tenantId: string;
}

export interface ListDueOutput {
  readonly subscriptionIds: readonly string[];
}

/** T14.5/G-74 (7): the renewal-billing scheduler job's own read — see {@link SubscriptionRepository.findDueForRenewal}. */
export class ListSubscriptionsDueForRenewal implements UseCase<
  ListDueInput,
  ListDueOutput,
  DomainError
> {
  private readonly deps: Pick<DunningDeps, "subscriptions" | "clock">;

  constructor(deps: Pick<DunningDeps, "subscriptions" | "clock">) {
    this.deps = deps;
  }

  async execute(input: ListDueInput): Promise<Result<ListDueOutput, DomainError>> {
    const due = await this.deps.subscriptions.findDueForRenewal(
      this.deps.clock.now(),
      input.tenantId,
    );
    return ok({ subscriptionIds: due.map((s) => s.id.toString()) });
  }
}

/** T14.5: the dunning-retry scheduler job's own read — see {@link SubscriptionRepository.findDueForDunningRetry}. */
export class ListSubscriptionsDueForDunningRetry implements UseCase<
  ListDueInput,
  ListDueOutput,
  DomainError
> {
  private readonly deps: Pick<DunningDeps, "subscriptions" | "clock">;

  constructor(deps: Pick<DunningDeps, "subscriptions" | "clock">) {
    this.deps = deps;
  }

  async execute(input: ListDueInput): Promise<Result<ListDueOutput, DomainError>> {
    const due = await this.deps.subscriptions.findDueForDunningRetry(
      this.deps.clock.now(),
      input.tenantId,
    );
    return ok({ subscriptionIds: due.map((s) => s.id.toString()) });
  }
}
