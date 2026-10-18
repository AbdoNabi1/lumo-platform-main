import type { UseCase } from "@platform/application";
import type { Clock } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, ValidationError } from "@platform/utils";
import type { OrderAnnotationRepository, OrderAnnotations } from "../domain/order-annotations";

/** At most this many orders per archive/unarchive call — the bulk action's cap (spec §1.4). */
export const MAX_ARCHIVE_BATCH = 50;
/** At most this many orders per annotations read — one export page (spec §1.4). */
export const MAX_ANNOTATION_READ = 250;

export interface ArchiveOrdersInput {
  /** ADR-0014: per-call tenant scope. */
  readonly tenantId: string;
  readonly orderIds: readonly string[];
  /** The acting staff principal. Part 1 records nothing with it; Part 2 writes it on the timeline entry. */
  readonly actorRef: string;
}

export interface OrderArchiveResult {
  readonly orderId: string;
  /** changed: this call archived/unarchived it · unchanged: already in that state · not_found: no such order in this shop. */
  readonly outcome: "changed" | "unchanged" | "not_found";
  /** The order's archive timestamp after the call (null: not archived, or not found). */
  readonly archivedAt: Date | null;
}

export interface ArchiveOrdersOutput {
  readonly results: readonly OrderArchiveResult[];
}

export interface OrderAnnotationsDeps {
  readonly annotations: OrderAnnotationRepository;
  readonly unitOfWork: TransactionalUnitOfWork<unknown>;
  readonly clock: Clock;
}

function batchOf(orderIds: readonly string[]): Result<readonly string[], DomainError> {
  const ids = [...new Set(orderIds)];
  if (ids.length === 0 || ids.length > MAX_ARCHIVE_BATCH) {
    return err(
      new ValidationError(`Choose between 1 and ${MAX_ARCHIVE_BATCH} orders`, [
        { field: "orderIds", message: `must hold 1 to ${MAX_ARCHIVE_BATCH} ids` },
      ]),
    );
  }
  return ok(ids);
}

/** One transaction: read the current state, change only what differs, answer a result per order. */
async function setArchiveState(
  deps: OrderAnnotationsDeps,
  input: ArchiveOrdersInput,
  archive: boolean,
): Promise<Result<ArchiveOrdersOutput, DomainError>> {
  const batch = batchOf(input.orderIds);
  if (!batch.ok) return err(batch.error);
  const ids = batch.value;
  const target = archive ? deps.clock.now() : null;
  const results = await deps.unitOfWork.run(async (tx) => {
    const before = await deps.annotations.annotationsOf(ids, input.tenantId, tx);
    const known = ids.filter((orderId) => before.has(orderId));
    const changed = new Set(
      known.length === 0
        ? []
        : await deps.annotations.setArchived(known, target, input.tenantId, tx),
    );
    // An order the guarded update left alone may have been changed by a concurrent writer after the
    // read above: answer its state AFTER the update (same tx), never that stale read.
    const unchanged = known.filter((orderId) => !changed.has(orderId));
    const after =
      unchanged.length === 0
        ? new Map<string, OrderAnnotations>()
        : await deps.annotations.annotationsOf(unchanged, input.tenantId, tx);
    return ids.map((orderId): OrderArchiveResult => {
      if (!before.has(orderId)) return { orderId, outcome: "not_found", archivedAt: null };
      if (changed.has(orderId)) return { orderId, outcome: "changed", archivedAt: target };
      const current = after.get(orderId);
      if (current === undefined) return { orderId, outcome: "not_found", archivedAt: null };
      return { orderId, outcome: "unchanged", archivedAt: current.archivedAt };
    });
  });
  return ok({ results });
}

/** Shopify's Archive for one or many orders (spec §1.2). Idempotent; never touches the aggregate. */
export class ArchiveOrders implements UseCase<
  ArchiveOrdersInput,
  ArchiveOrdersOutput,
  DomainError
> {
  private readonly deps: OrderAnnotationsDeps;

  constructor(deps: OrderAnnotationsDeps) {
    this.deps = deps;
  }

  execute(input: ArchiveOrdersInput): Promise<Result<ArchiveOrdersOutput, DomainError>> {
    return setArchiveState(this.deps, input, true);
  }
}

/** Shopify's Unarchive. Idempotent; never touches the aggregate. */
export class UnarchiveOrders implements UseCase<
  ArchiveOrdersInput,
  ArchiveOrdersOutput,
  DomainError
> {
  private readonly deps: OrderAnnotationsDeps;

  constructor(deps: OrderAnnotationsDeps) {
    this.deps = deps;
  }

  execute(input: ArchiveOrdersInput): Promise<Result<ArchiveOrdersOutput, DomainError>> {
    return setArchiveState(this.deps, input, false);
  }
}

export interface GetOrderAnnotationsInput {
  readonly tenantId: string;
  readonly orderIds: readonly string[];
}

/** The annotations of a page of orders in ONE read (the list's Archived badge, export rows). */
export class GetOrderAnnotations implements UseCase<
  GetOrderAnnotationsInput,
  ReadonlyMap<string, OrderAnnotations>,
  DomainError
> {
  private readonly deps: Pick<OrderAnnotationsDeps, "annotations">;

  constructor(deps: Pick<OrderAnnotationsDeps, "annotations">) {
    this.deps = deps;
  }

  async execute(
    input: GetOrderAnnotationsInput,
  ): Promise<Result<ReadonlyMap<string, OrderAnnotations>, DomainError>> {
    const ids = [...new Set(input.orderIds)];
    if (ids.length > MAX_ANNOTATION_READ) {
      return err(
        new ValidationError(`At most ${MAX_ANNOTATION_READ} orders per read`, [
          { field: "orderIds", message: `must hold at most ${MAX_ANNOTATION_READ} ids` },
        ]),
      );
    }
    if (ids.length === 0) return ok(new Map());
    return ok(await this.deps.annotations.annotationsOf(ids, input.tenantId));
  }
}
