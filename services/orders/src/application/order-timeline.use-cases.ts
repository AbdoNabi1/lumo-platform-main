import type { UseCase } from "@platform/application";
import type { Clock, IdGenerator } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import {
  AuthorizationError,
  BusinessRuleError,
  ConflictError,
  type DomainError,
  NotFoundError,
} from "@platform/utils";
import type { OrderAnnotationRepository } from "../domain/order-annotations";
import {
  normalizeCommentBody,
  TIMELINE_READ_LIMIT,
  type OrderTimelineEntry,
  type OrderTimelineRepository,
} from "../domain/order-timeline";
import { authorNameOf } from "./order-activity";
import type { StaffDirectoryPort } from "./ports";

export interface OrderTimelineDeps {
  /** Only to know the order exists in this shop (one read). */
  readonly annotations: Pick<OrderAnnotationRepository, "annotationsOf">;
  readonly timeline: OrderTimelineRepository;
  readonly staff: StaffDirectoryPort;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
}

export interface AddOrderCommentInput {
  readonly tenantId: string;
  readonly orderId: string;
  readonly body: string;
  /** The acting staff principal — the author. Never taken from the request body. */
  readonly actorRef: string;
}

export interface EditOrderCommentInput extends AddOrderCommentInput {
  readonly entryId: string;
}

export interface DeleteOrderCommentInput {
  readonly tenantId: string;
  readonly orderId: string;
  readonly entryId: string;
  readonly actorRef: string;
  /** The actor may delete ANY comment (an admin: `comments:moderate`) — decided by the caller. */
  readonly canModerate: boolean;
}

export interface ListOrderTimelineInput {
  readonly tenantId: string;
  readonly orderId: string;
}

/** The comment `entryId` of THIS order of this shop — another order's entry, or an activity line, is refused. */
async function commentOf(
  deps: OrderTimelineDeps,
  input: { readonly tenantId: string; readonly orderId: string; readonly entryId: string },
  tx: unknown,
): Promise<Result<OrderTimelineEntry, DomainError>> {
  const entry = await deps.timeline.findById(input.entryId, input.tenantId, tx);
  if (entry === null || entry.orderId !== input.orderId) {
    return err(new NotFoundError("Comment not found"));
  }
  if (entry.kind !== "comment") {
    return err(new BusinessRuleError("Activity lines are a record and can't be changed"));
  }
  return ok(entry);
}

/** Shopify's "Leave a comment..." (spec §2.2). The author and the name snapshot come from the server. */
export class AddOrderComment implements UseCase<
  AddOrderCommentInput,
  OrderTimelineEntry,
  DomainError
> {
  private readonly deps: OrderTimelineDeps;

  constructor(deps: OrderTimelineDeps) {
    this.deps = deps;
  }

  async execute(input: AddOrderCommentInput): Promise<Result<OrderTimelineEntry, DomainError>> {
    const body = normalizeCommentBody(input.body);
    if (!body.ok) return err(body.error);
    const authorName = await authorNameOf(this.deps.staff, input.actorRef, input.tenantId);
    const now = this.deps.clock.now();
    return this.deps.unitOfWork.run(
      async (tx): Promise<Result<OrderTimelineEntry, DomainError>> => {
        // The timeline table has no FK to `orders`: the order must be THIS shop's (same tx) first.
        const known = await this.deps.annotations.annotationsOf(
          [input.orderId],
          input.tenantId,
          tx,
        );
        if (!known.has(input.orderId)) return err(new NotFoundError("Order not found"));
        const entry: OrderTimelineEntry = {
          id: this.deps.idGenerator.generate(),
          orderId: input.orderId,
          kind: "comment",
          authorRef: input.actorRef,
          authorName,
          body: body.value,
          data: {},
          createdAt: now,
          editedAt: null,
          deletedAt: null,
        };
        await this.deps.timeline.append(entry, input.tenantId, tx);
        return ok(entry);
      },
    );
  }
}

/** Only the author edits their own comment; a deleted comment and activity lines are never edited. */
export class EditOrderComment implements UseCase<
  EditOrderCommentInput,
  OrderTimelineEntry,
  DomainError
> {
  private readonly deps: OrderTimelineDeps;

  constructor(deps: OrderTimelineDeps) {
    this.deps = deps;
  }

  async execute(input: EditOrderCommentInput): Promise<Result<OrderTimelineEntry, DomainError>> {
    const body = normalizeCommentBody(input.body);
    if (!body.ok) return err(body.error);
    const now = this.deps.clock.now();
    return this.deps.unitOfWork.run(
      async (tx): Promise<Result<OrderTimelineEntry, DomainError>> => {
        const found = await commentOf(this.deps, input, tx);
        if (!found.ok) return found;
        const entry = found.value;
        if (entry.deletedAt !== null) return err(new ConflictError("This comment was deleted"));
        if (entry.authorRef !== input.actorRef) {
          return err(new AuthorizationError("Only its author can edit a comment"));
        }
        if (entry.body === body.value) return ok(entry);
        const edited: OrderTimelineEntry = { ...entry, body: body.value, editedAt: now };
        await this.deps.timeline.update(edited, input.tenantId, tx);
        return ok(edited);
      },
    );
  }
}

/** Soft delete (spec §2.2): the author, or a moderator (admin), may delete; the row stays for the audit trail. */
export class DeleteOrderComment implements UseCase<
  DeleteOrderCommentInput,
  OrderTimelineEntry,
  DomainError
> {
  private readonly deps: OrderTimelineDeps;

  constructor(deps: OrderTimelineDeps) {
    this.deps = deps;
  }

  async execute(input: DeleteOrderCommentInput): Promise<Result<OrderTimelineEntry, DomainError>> {
    const now = this.deps.clock.now();
    return this.deps.unitOfWork.run(
      async (tx): Promise<Result<OrderTimelineEntry, DomainError>> => {
        const found = await commentOf(this.deps, input, tx);
        if (!found.ok) return found;
        const entry = found.value;
        if (entry.authorRef !== input.actorRef && !input.canModerate) {
          return err(new AuthorizationError("Only its author or an admin can delete a comment"));
        }
        if (entry.deletedAt !== null) return ok(entry);
        const deleted: OrderTimelineEntry = { ...entry, deletedAt: now };
        await this.deps.timeline.update(deleted, input.tenantId, tx);
        return ok(deleted);
      },
    );
  }
}

/** The order page's timeline lines: the latest {@link TIMELINE_READ_LIMIT}, newest first. */
export class ListOrderTimeline implements UseCase<
  ListOrderTimelineInput,
  readonly OrderTimelineEntry[],
  DomainError
> {
  private readonly deps: Pick<OrderTimelineDeps, "timeline">;

  constructor(deps: Pick<OrderTimelineDeps, "timeline">) {
    this.deps = deps;
  }

  async execute(
    input: ListOrderTimelineInput,
  ): Promise<Result<readonly OrderTimelineEntry[], DomainError>> {
    return ok(
      await this.deps.timeline.listForOrder(input.orderId, input.tenantId, {
        first: TIMELINE_READ_LIMIT,
      }),
    );
  }
}
