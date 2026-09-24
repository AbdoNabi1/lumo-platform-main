import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import { BusinessRuleError, UniqueEntityId } from "@platform/domain";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError, isDomainError } from "@platform/utils";
import { Invoice } from "../domain/invoice";
import type {
  InvoiceRepository,
  PlanRepository,
  SubscriptionRepository,
} from "../domain/repositories";
import type { CollectInvoice } from "./billing.use-cases";
import { findPinnedVersion } from "./licensing.use-cases";

export interface BillSubscriptionRenewalDeps {
  readonly subscriptions: SubscriptionRepository;
  readonly plans: PlanRepository;
  readonly invoices: InvoiceRepository;
  readonly collectInvoice: CollectInvoice;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

export interface BillSubscriptionRenewalInput {
  readonly subscriptionId: string;
  readonly tenantId: string;
}

export interface BillSubscriptionRenewalOutput {
  readonly invoiceId: string;
  /** `failed` is an expected outcome (a declined charge), not an exception; T14.5's dunning reads it. */
  readonly status: "paid" | "failed";
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Bills one renewal period of a subscription (WP-14 T14.4) — the price is READ from the subscription's
 * PINNED plan version, never from a caller, a live plan, or a hardcoded number (DoD: "no price is
 * hardcoded anywhere in the billing path"). A price change publishes a new version; it cannot reach a
 * subscription that pinned an older one — only an explicit `RepinSubscription` can.
 *
 * One transaction creates the invoice, issues it and advances `renewalSchedule.nextRenewalAt` by the
 * cycle, so a second call in the same period finds the subscription not yet due and is refused: one
 * invoice per period, and therefore one charge (`CollectInvoice` then keys the PSP call on that
 * invoice). The collection runs AFTER, through the unchanged `CollectInvoice` (its own short
 * transactions, the PSP call outside any of them). A declined charge leaves the invoice `failed`
 * (`failed -> issued` stays available); the retry schedule and the `active -> past_due -> suspended`
 * machine around it are T14.5's, not this use case's.
 */
export class BillSubscriptionRenewal implements UseCase<
  BillSubscriptionRenewalInput,
  BillSubscriptionRenewalOutput,
  DomainError
> {
  private readonly deps: BillSubscriptionRenewalDeps;

  constructor(deps: BillSubscriptionRenewalDeps) {
    this.deps = deps;
  }

  async execute(
    input: BillSubscriptionRenewalInput,
  ): Promise<Result<BillSubscriptionRenewalOutput, DomainError>> {
    const prepared = await this.prepare(input);
    if (!prepared.ok) return err(prepared.error);
    const invoiceId = prepared.value;

    try {
      const collected = await this.deps.collectInvoice.execute({
        invoiceId,
        tenantId: input.tenantId,
      });
      if (!collected.ok) return err(collected.error);
      return ok({ invoiceId, status: "paid" });
    } catch (error) {
      // `CollectInvoice` has already durably marked the invoice `failed` before rethrowing a PSP
      // failure. Only report `failed` if that is what was actually recorded; anything else (e.g. a
      // database error after money moved) is not a declined charge and must surface.
      const invoice = await this.deps.invoices.findById(invoiceId, input.tenantId);
      if (invoice?.status === "failed") return ok({ invoiceId, status: "failed" });
      throw error;
    }
  }

  private async prepare(input: BillSubscriptionRenewalInput): Promise<Result<string, DomainError>> {
    return this.deps.unitOfWork.run<Result<string, DomainError>>(async (tx) => {
      const subscription = await this.deps.subscriptions.findById(
        input.subscriptionId,
        input.tenantId,
        tx,
      );
      if (subscription === null) return err(new NotFoundError("Subscription not found"));
      if (subscription.status !== "active") {
        return err(new BusinessRuleError(`Cannot bill a ${subscription.status} subscription`));
      }
      const schedule = subscription.renewalSchedule;
      if (schedule === undefined) {
        return err(new BusinessRuleError("Subscription has no renewal schedule"));
      }
      const now = this.deps.clock.now();
      if (schedule.nextRenewalAt.getTime() > now.getTime()) {
        return err(
          new BusinessRuleError(
            `Subscription is not due until ${schedule.nextRenewalAt.toISOString()}`,
          ),
        );
      }

      // The PINNED version — the whole point. `plan.publishedVersionId` is never consulted.
      const version = await findPinnedVersion(this.deps.plans, subscription.planVersionRef, tx);
      if (version === undefined || version.status === "draft" || version.status === "scheduled") {
        return err(
          new BusinessRuleError(
            `Pinned plan version "${subscription.planVersionRef}" is not a billable published version`,
          ),
        );
      }
      const { basePriceMinor, currency, billingCycle } = version.spec.pricing;
      if (currency === "XXX") {
        return err(
          new BusinessRuleError(
            `Plan version "${subscription.planVersionRef}" has no billing currency (it predates the minor-unit price convention); publish a new version and re-pin the subscription`,
          ),
        );
      }
      if (basePriceMinor === 0) {
        return err(new BusinessRuleError("Plan version price is zero; there is nothing to bill"));
      }

      try {
        const invoiceId = UniqueEntityId.from(this.deps.idGenerator.generate());
        const invoice = Invoice.createDraft(
          invoiceId,
          subscription.tenantRef,
          subscription.id.toString(),
          currency,
          [
            {
              description: `Subscription renewal (${billingCycle}) — ${subscription.planVersionRef}`,
              amountMinor: basePriceMinor,
            },
          ],
          this.deps.idGenerator.generate(),
          now,
        );
        invoice.issue(this.deps.idGenerator.generate(), now);
        subscription.setRenewalSchedule({
          cycleDays: schedule.cycleDays,
          nextRenewalAt: new Date(schedule.nextRenewalAt.getTime() + schedule.cycleDays * DAY_MS),
        });
        await this.deps.invoices.save(invoice, input.tenantId, tx);
        await this.deps.subscriptions.save(subscription, input.tenantId, tx);
        return ok(invoiceId.toString());
      } catch (error) {
        if (isDomainError(error)) return err(error);
        throw error;
      }
    });
  }
}
