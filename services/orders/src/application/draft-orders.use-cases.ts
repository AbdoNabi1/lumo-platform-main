import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import {
  BusinessRuleError,
  ConcurrencyError,
  type DomainError,
  logger,
  NotFoundError,
} from "@platform/utils";
import type { OrderAnnotationRepository } from "../domain/order-annotations";
import {
  clampDraftPageSize,
  DraftOrder,
  normalizeDraftContent,
  normalizeDraftSearch,
  type DraftOrderContent,
  type DraftOrderStatus,
} from "../domain/draft-order";
import type {
  DraftNumberAllocator,
  DraftOrderPage,
  DraftOrderRepository,
} from "../domain/draft-order-repository";
import { parseTags } from "../domain/order-tags";
import { authorNameOf, type OrderActivityDeps } from "./order-activity";

export interface DraftOrdersDeps {
  readonly drafts: DraftOrderRepository;
  readonly draftNumbers: DraftNumberAllocator;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /** Where the completed order's note and tags are copied (Part 2's annotations). */
  readonly annotations: OrderAnnotationRepository;
  /** Where the `created_from_draft` line is written. */
  readonly activity: OrderActivityDeps;
}

export interface DraftOrderIdInput {
  /** ADR-0014: per-call tenant scope. */
  readonly tenantId: string;
  readonly draftId: string;
}

export interface DraftOrderOutput {
  readonly draft: DraftOrder;
}

function draftNotFound(): NotFoundError {
  return new NotFoundError("Draft order not found");
}

function completedRefusal(): BusinessRuleError {
  return new BusinessRuleError("DRAFT_COMPLETED: this draft order is already an order");
}

export interface CreateDraftOrderInput {
  readonly tenantId: string;
  /** The staff principal id. */
  readonly createdBy: string;
  /** The shop's currency — the lines were priced in it by the caller. */
  readonly currency: string;
  /** Lines priced server-side by the caller (never a browser price — anti-goal 1). */
  readonly content: DraftOrderContent;
}

/** Spec §4.8: a new draft, numbered D1, D2, … in the same transaction. */
export class CreateDraftOrder implements UseCase<
  CreateDraftOrderInput,
  DraftOrderOutput,
  DomainError
> {
  private readonly deps: DraftOrdersDeps;

  constructor(deps: DraftOrdersDeps) {
    this.deps = deps;
  }

  async execute(input: CreateDraftOrderInput): Promise<Result<DraftOrderOutput, DomainError>> {
    // Validated BEFORE a number is allocated: a refused draft never burns one.
    const content = normalizeDraftContent(input.content);
    if (!content.ok) return err(content.error);
    // The allocator row-locks the shop's shared `order_number_counters` row until this transaction
    // commits, so every order placement of the shop waits behind it. Keep the transaction short:
    // everything that needs I/O (Catalog pricing, shipping quotes, lookups) happened before the
    // caller got here, and nothing remote may be added after `next()` below.
    return this.deps.unitOfWork.run<Result<DraftOrderOutput, DomainError>>(async (tx) => {
      const draftNumber = await this.deps.draftNumbers.next(input.tenantId, tx);
      // Built here, inside the callback, and this use case never retries the transaction: a
      // `DraftOrder` flips to persisted on insert (before the commit), so an instance from a
      // rolled-back attempt must never be reused — a retrying caller would build a fresh one.
      const created = DraftOrder.create({
        id: this.deps.idGenerator.generate(),
        draftNumber,
        currency: input.currency,
        createdBy: input.createdBy,
        now: this.deps.clock.now(),
        content: content.value,
      });
      if (!created.ok) return err(created.error);
      await this.deps.drafts.save(created.value, input.tenantId, tx);
      const stored = await this.deps.drafts.findById(created.value.id, input.tenantId, tx);
      return ok({ draft: stored ?? created.value });
    });
  }
}

export interface UpdateDraftOrderInput extends DraftOrderIdInput {
  /** The version the editor loaded (optimistic lock). */
  readonly version: number;
  readonly content: DraftOrderContent;
}

/** Spec §4.8 `PUT`: the full content, version-checked; refused once completed. */
export class UpdateDraftOrder implements UseCase<
  UpdateDraftOrderInput,
  DraftOrderOutput,
  DomainError
> {
  private readonly deps: DraftOrdersDeps;

  constructor(deps: DraftOrdersDeps) {
    this.deps = deps;
  }

  async execute(input: UpdateDraftOrderInput): Promise<Result<DraftOrderOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<DraftOrderOutput, DomainError>>(async (tx) => {
      const draft = await this.deps.drafts.findById(input.draftId, input.tenantId, tx);
      if (draft === null || draft.deletedAt !== null) return err(draftNotFound());
      if (draft.status === "completed") return err(completedRefusal());
      if (draft.version !== input.version) {
        return err(
          new ConcurrencyError("VERSION_CONFLICT: this draft order was changed by someone else"),
        );
      }
      const revised = draft.revise(input.content, this.deps.clock.now());
      if (!revised.ok) return err(revised.error);
      try {
        await this.deps.drafts.save(draft, input.tenantId, tx);
      } catch (error) {
        if (error instanceof ConcurrencyError) return err(error);
        throw error;
      }
      const stored = await this.deps.drafts.findById(input.draftId, input.tenantId, tx);
      return stored === null ? err(draftNotFound()) : ok({ draft: stored });
    });
  }
}

/** Spec §4.2 decision: a soft delete, only for open/invoice_sent drafts. */
export class DeleteDraftOrder implements UseCase<
  DraftOrderIdInput,
  { readonly draftId: string },
  DomainError
> {
  private readonly deps: DraftOrdersDeps;

  constructor(deps: DraftOrdersDeps) {
    this.deps = deps;
  }

  async execute(
    input: DraftOrderIdInput,
  ): Promise<Result<{ readonly draftId: string }, DomainError>> {
    return this.deps.unitOfWork.run<Result<{ readonly draftId: string }, DomainError>>(
      async (tx) => {
        const draft = await this.deps.drafts.findById(input.draftId, input.tenantId, tx);
        if (draft === null || draft.deletedAt !== null) return err(draftNotFound());
        if (draft.status === "completed") return err(completedRefusal());
        const deleted = await this.deps.drafts.softDelete(
          input.draftId,
          this.deps.clock.now(),
          input.tenantId,
          tx,
        );
        if (deleted) return ok({ draftId: input.draftId });
        // Lost a race: deleted meanwhile is "not found", completed meanwhile is the refusal.
        const current = await this.deps.drafts.findById(input.draftId, input.tenantId, tx);
        return current === null || current.deletedAt !== null
          ? err(draftNotFound())
          : err(completedRefusal());
      },
    );
  }
}

/** One draft; a deleted draft is not found (the invoice claim relies on it: deleted → 404). */
export class GetDraftOrder implements UseCase<DraftOrderIdInput, DraftOrder, DomainError> {
  private readonly deps: Pick<DraftOrdersDeps, "drafts">;

  constructor(deps: Pick<DraftOrdersDeps, "drafts">) {
    this.deps = deps;
  }

  async execute(input: DraftOrderIdInput): Promise<Result<DraftOrder, DomainError>> {
    const draft = await this.deps.drafts.findById(input.draftId, input.tenantId);
    return draft === null || draft.deletedAt !== null ? err(draftNotFound()) : ok(draft);
  }
}

export interface ListDraftOrdersInput {
  readonly tenantId: string;
  readonly status?: DraftOrderStatus;
  readonly search?: string;
  readonly first?: number;
  readonly after?: string;
}

export class ListDraftOrders implements UseCase<ListDraftOrdersInput, DraftOrderPage, DomainError> {
  private readonly deps: Pick<DraftOrdersDeps, "drafts">;

  constructor(deps: Pick<DraftOrdersDeps, "drafts">) {
    this.deps = deps;
  }

  async execute(input: ListDraftOrdersInput): Promise<Result<DraftOrderPage, DomainError>> {
    const search = normalizeDraftSearch(input.search);
    return ok(
      await this.deps.drafts.list(
        {
          first: clampDraftPageSize(input.first),
          ...(input.status === undefined ? {} : { status: input.status }),
          ...(search === undefined ? {} : { search }),
          ...(input.after === undefined ? {} : { after: input.after }),
        },
        input.tenantId,
      ),
    );
  }
}

/** Spec §4.7: `status = invoice_sent` and `invoiceSentAt` (guarded, no version bump — Ruling 2). */
export class MarkDraftInvoiceSent implements UseCase<
  DraftOrderIdInput,
  DraftOrderOutput,
  DomainError
> {
  private readonly deps: DraftOrdersDeps;

  constructor(deps: DraftOrdersDeps) {
    this.deps = deps;
  }

  async execute(input: DraftOrderIdInput): Promise<Result<DraftOrderOutput, DomainError>> {
    return this.deps.unitOfWork.run<Result<DraftOrderOutput, DomainError>>(async (tx) => {
      const marked = await this.deps.drafts.markInvoiceSent(
        input.draftId,
        this.deps.clock.now(),
        input.tenantId,
        tx,
      );
      const draft = await this.deps.drafts.findById(input.draftId, input.tenantId, tx);
      if (draft === null || draft.deletedAt !== null) return err(draftNotFound());
      if (!marked) return err(completedRefusal());
      return ok({ draft });
    });
  }
}

export interface SetDraftCheckoutInput extends DraftOrderIdInput {
  readonly checkoutRef: string;
  /** The draft version the session was built from. */
  readonly checkoutVersion: number;
  /** The `checkoutRef` the caller read (compare-and-set, Ruling 3). */
  readonly expectedCheckoutRef: string | null;
}

/** Records the materialised session (spec §4.5 step 3). */
export class SetDraftCheckout implements UseCase<
  SetDraftCheckoutInput,
  { readonly applied: boolean },
  DomainError
> {
  private readonly deps: DraftOrdersDeps;

  constructor(deps: DraftOrdersDeps) {
    this.deps = deps;
  }

  async execute(
    input: SetDraftCheckoutInput,
  ): Promise<Result<{ readonly applied: boolean }, DomainError>> {
    return this.deps.unitOfWork.run(async (tx) =>
      ok({
        applied: await this.deps.drafts.setCheckout(
          input.draftId,
          { checkoutRef: input.checkoutRef, checkoutVersion: input.checkoutVersion },
          input.expectedCheckoutRef,
          input.tenantId,
          tx,
        ),
      }),
    );
  }
}

export interface CompleteDraftFromCheckoutInput extends DraftOrderIdInput {
  readonly orderRef: string;
  /** The staff member who completed it; absent when the shopper paid through the invoice link. */
  readonly actorRef?: string;
}

export interface CompleteDraftFromCheckoutOutput {
  readonly draftId: string;
  readonly orderRef: string;
  /** False when this order already completed the draft (idempotent repeat). */
  readonly changed: boolean;
}

/**
 * Spec §4.6 step 5 / §4.6 decision: the draft became `orderRef`. In ONE transaction: mark it completed
 * (guarded), copy its note and tags onto the order (Part 2's annotations, never the Order aggregate)
 * and append `created_from_draft` ("Order created from draft #D3", with the draft's id for the
 * back-link). Idempotent for the same order; called by the admin complete route, by Checkout's
 * `DraftOrderCompletionPort` and by the self-heal (Ruling 10).
 */
export class CompleteDraftFromCheckout implements UseCase<
  CompleteDraftFromCheckoutInput,
  CompleteDraftFromCheckoutOutput,
  DomainError
> {
  private readonly deps: DraftOrdersDeps;

  constructor(deps: DraftOrdersDeps) {
    this.deps = deps;
  }

  async execute(
    input: CompleteDraftFromCheckoutInput,
  ): Promise<Result<CompleteDraftFromCheckoutOutput, DomainError>> {
    // The staff-name lookup is remote I/O: read once, before the transaction opens.
    const authorName =
      input.actorRef === undefined
        ? null
        : await authorNameOf(this.deps.activity.staff, input.actorRef, input.tenantId);
    return this.deps.unitOfWork.run<Result<CompleteDraftFromCheckoutOutput, DomainError>>(
      async (tx) => {
        const draft = await this.deps.drafts.findById(input.draftId, input.tenantId, tx);
        if (draft === null) return err(draftNotFound());
        const same = { draftId: draft.id, orderRef: input.orderRef };
        if (draft.status === "completed") {
          return draft.orderRef === input.orderRef
            ? ok({ ...same, changed: false })
            : err(completedRefusal());
        }
        // Verified BEFORE the guarded write: the order is another context's commit, and a ref this
        // shop cannot see must not close the draft for good (every retry would take the completed
        // branch above and skip the note, tags and timeline line).
        const verified = await this.deps.annotations.annotationsOf(
          [input.orderRef],
          input.tenantId,
          tx,
        );
        if (!verified.has(input.orderRef)) {
          logger.warn("draft completion refused: the order is not visible to this shop", {
            tenantId: input.tenantId,
            draftId: draft.id,
          });
          return err(new NotFoundError("Order not found"));
        }
        const at = this.deps.clock.now();
        const changed = await this.deps.drafts.markCompleted(
          draft.id,
          { orderRef: input.orderRef, at },
          input.tenantId,
          tx,
        );
        if (!changed) {
          // Lost a race (Postgres READ COMMITTED): whoever won decides. The same order is an
          // idempotent repeat; another order must not be reported as this caller's success.
          const current = await this.deps.drafts.findById(input.draftId, input.tenantId, tx);
          if (current === null) return err(draftNotFound());
          return current.status === "completed" && current.orderRef === input.orderRef
            ? ok({ ...same, changed: false })
            : err(completedRefusal());
        }
        if (draft.note !== null) {
          await this.deps.annotations.setNote(input.orderRef, draft.note, input.tenantId, tx);
        }
        const tags = parseTags(draft.tags);
        if (tags.ok && tags.value.length > 0) {
          await this.deps.annotations.addTags([input.orderRef], tags.value, input.tenantId, tx);
        }
        await this.deps.activity.timeline.append(
          {
            id: this.deps.activity.idGenerator.generate(),
            orderId: input.orderRef,
            kind: "created_from_draft",
            authorRef: input.actorRef ?? null,
            authorName,
            body: null,
            data: { draftNumber: draft.draftNumber, draftId: draft.id },
            createdAt: at,
            editedAt: null,
            deletedAt: null,
          },
          input.tenantId,
          tx,
        );
        return ok({ ...same, changed: true });
      },
    );
  }
}
