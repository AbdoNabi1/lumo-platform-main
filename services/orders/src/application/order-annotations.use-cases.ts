import type { UseCase } from "@platform/application";
import type { Clock } from "@platform/contracts";
import type { TransactionalUnitOfWork } from "@platform/repository";
import { err, ok, type Result } from "@platform/types";
import { type DomainError, NotFoundError, ValidationError } from "@platform/utils";
import type { OrderAnnotationRepository, OrderAnnotations } from "../domain/order-annotations";
import {
  characterCount,
  clampSuggestionLimit,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_ORDER,
  normalizeNote,
  normalizeTag,
  parseTags,
  TAG_SUGGESTION_LIMIT,
  tagKeyOf,
  type OrderTag,
  type TagUsage,
} from "../domain/order-tags";
import type { OrderActivityKind, OrderTimelineData } from "../domain/order-timeline";
import {
  activityEntry,
  authorNameOf,
  type ActivityAuthor,
  type OrderActivityDeps,
} from "./order-activity";

/** At most this many orders per archive/unarchive/tag call — the bulk action's cap (spec §1.4). */
export const MAX_ARCHIVE_BATCH = 50;
/** At most this many orders per annotations read — one export page (spec §1.4). */
export const MAX_ANNOTATION_READ = 250;

export interface ArchiveOrdersInput {
  /** ADR-0014: per-call tenant scope. */
  readonly tenantId: string;
  readonly orderIds: readonly string[];
  /** The acting staff principal; Part 2 writes it (and its name) on the timeline line. */
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
  /** Part 2: where annotation activity lines are written. Absent ⇒ none (Part 1's tests). */
  readonly activity?: OrderActivityDeps;
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

/** The actor's name, read before the transaction — only when activity is recorded. */
async function authorFor(
  deps: OrderAnnotationsDeps,
  actorRef: string,
  tenantId: string,
): Promise<ActivityAuthor | undefined> {
  if (deps.activity === undefined) return undefined;
  return { actorRef, authorName: await authorNameOf(deps.activity.staff, actorRef, tenantId) };
}

interface ActivityLine {
  readonly orderId: string;
  readonly kind: OrderActivityKind;
  readonly data: OrderTimelineData;
}

/**
 * Appends the lines INSIDE the caller's transaction (`tx`): they commit or roll back with the change.
 * The timeline table has no FK to `orders`, so a line is only ever written for an order `verified`
 * as THIS shop's by the same transaction's `annotationsOf` read — never for an unknown or another
 * shop's id, whatever the caller computed.
 */
async function recordActivity(
  deps: OrderAnnotationsDeps,
  author: ActivityAuthor | undefined,
  lines: readonly ActivityLine[],
  verified: ReadonlyMap<string, OrderAnnotations>,
  at: Date,
  tenantId: string,
  tx: unknown,
): Promise<void> {
  const activity = deps.activity;
  if (activity === undefined || author === undefined) return;
  for (const line of lines) {
    if (!verified.has(line.orderId)) continue;
    await activity.timeline.append(
      activityEntry(
        activity.idGenerator.generate(),
        line.orderId,
        line.kind,
        author,
        line.data,
        at,
      ),
      tenantId,
      tx,
    );
  }
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
  const now = deps.clock.now();
  const target = archive ? now : null;
  const author = await authorFor(deps, input.actorRef, input.tenantId);
  const results = await deps.unitOfWork.run(async (tx) => {
    const before = await deps.annotations.annotationsOf(ids, input.tenantId, tx);
    const known = ids.filter((orderId) => before.has(orderId));
    const changed = new Set(
      known.length === 0
        ? []
        : await deps.annotations.setArchived(known, target, input.tenantId, tx),
    );
    await recordActivity(
      deps,
      author,
      ids
        .filter((orderId) => changed.has(orderId))
        .map((orderId): ActivityLine => ({
          orderId,
          kind: archive ? "archived" : "unarchived",
          data: {},
        })),
      before,
      now,
      input.tenantId,
      tx,
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

/** The annotations of a page of orders in ONE read (the list's badge and tags, export rows, slips). */
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

// ── Part 2: the note ─────────────────────────────────────────────────────────────────────────────

export interface UpdateOrderNoteInput {
  readonly tenantId: string;
  readonly orderId: string;
  /** As typed; blank or null removes the note. */
  readonly note: string | null;
  readonly actorRef: string;
}

export interface UpdateOrderNoteOutput {
  readonly orderId: string;
  readonly note: string | null;
  /** false when the note was already exactly this (no line written). */
  readonly changed: boolean;
}

/** Shopify's Notes card (spec §2.2): writes the note and its `note_changed` line in one transaction. */
export class UpdateOrderNote implements UseCase<
  UpdateOrderNoteInput,
  UpdateOrderNoteOutput,
  DomainError
> {
  private readonly deps: OrderAnnotationsDeps;

  constructor(deps: OrderAnnotationsDeps) {
    this.deps = deps;
  }

  async execute(input: UpdateOrderNoteInput): Promise<Result<UpdateOrderNoteOutput, DomainError>> {
    const note = normalizeNote(input.note);
    if (!note.ok) return err(note.error);
    const author = await authorFor(this.deps, input.actorRef, input.tenantId);
    const now = this.deps.clock.now();
    return this.deps.unitOfWork.run(
      async (tx): Promise<Result<UpdateOrderNoteOutput, DomainError>> => {
        const verified = await this.deps.annotations.annotationsOf(
          [input.orderId],
          input.tenantId,
          tx,
        );
        const before = verified.get(input.orderId);
        if (before === undefined) return err(new NotFoundError("Order not found"));
        if (before.note === note.value) {
          return ok({ orderId: input.orderId, note: note.value, changed: false });
        }
        await this.deps.annotations.setNote(input.orderId, note.value, input.tenantId, tx);
        await recordActivity(
          this.deps,
          author,
          [
            {
              orderId: input.orderId,
              kind: "note_changed",
              data: { cleared: note.value === null },
            },
          ],
          verified,
          now,
          input.tenantId,
          tx,
        );
        return ok({ orderId: input.orderId, note: note.value, changed: true });
      },
    );
  }
}

// ── Part 2: tags ─────────────────────────────────────────────────────────────────────────────────

export interface ChangeOrderTagsInput {
  readonly tenantId: string;
  /** 1..50 orders (the bulk cap); duplicates collapse. */
  readonly orderIds: readonly string[];
  /** As typed — commas split, case-insensitive duplicates collapse; 1..250 tags of ≤ 40 characters. */
  readonly tags: readonly string[];
  readonly actorRef: string;
}

export interface OrderTagsResult {
  readonly orderId: string;
  /**
   * changed: tags were added/removed · unchanged: it already had / never had them · not_found: no such
   * order in this shop · too_many_tags: adding would pass 250 tags, so nothing was added to it (bulk
   * only — a one-order add past the cap is a VALIDATION error instead).
   */
  readonly outcome: "changed" | "unchanged" | "not_found" | "too_many_tags";
  /** The order's tags after the call ([] when not found). */
  readonly tags: readonly string[];
  /** What this call added or removed on this order, as spelled. */
  readonly changedTags: readonly string[];
}

export interface ChangeOrderTagsOutput {
  readonly results: readonly OrderTagsResult[];
}

function tooManyTagsError(): ValidationError {
  return new ValidationError(`An order can have at most ${MAX_TAGS_PER_ORDER} tags`, [
    { field: "tags", message: `an order can carry at most ${MAX_TAGS_PER_ORDER} tags` },
  ]);
}

function tagBatchOf(
  input: ChangeOrderTagsInput,
): Result<{ readonly ids: readonly string[]; readonly tags: readonly OrderTag[] }, DomainError> {
  const ids = batchOf(input.orderIds);
  if (!ids.ok) return err(ids.error);
  const tags = parseTags(input.tags);
  if (!tags.ok) return err(tags.error);
  if (tags.value.length === 0 || tags.value.length > MAX_TAGS_PER_ORDER) {
    return err(
      new ValidationError(`Give between 1 and ${MAX_TAGS_PER_ORDER} tags`, [
        { field: "tags", message: `must hold 1 to ${MAX_TAGS_PER_ORDER} tags` },
      ]),
    );
  }
  return ok({ ids: ids.value, tags: tags.value });
}

/**
 * The orders among `known` that adding `tags` would push past {@link MAX_TAGS_PER_ORDER}, counted
 * from the same transaction's read: only keys an order does not carry yet count as new.
 */
function overTheCap(
  known: readonly string[],
  before: ReadonlyMap<string, OrderAnnotations>,
  tags: readonly OrderTag[],
): ReadonlySet<string> {
  const over = new Set<string>();
  for (const orderId of known) {
    const keys = new Set((before.get(orderId)?.tags ?? []).map(tagKeyOf));
    const fresh = tags.filter((tag) => !keys.has(tag.tagKey)).length;
    if (keys.size + fresh > MAX_TAGS_PER_ORDER) over.add(orderId);
  }
  return over;
}

/**
 * Adds or removes tags on up to 50 orders in ONE transaction, with a line per changed order. The
 * `tags_added` / `tags_removed` line carries exactly what the repository reports it wrote — for an
 * add, the rows actually inserted (a concurrent add of the same key is not reported twice).
 */
async function changeTags(
  deps: OrderAnnotationsDeps,
  input: ChangeOrderTagsInput,
  add: boolean,
): Promise<Result<ChangeOrderTagsOutput, DomainError>> {
  const batch = tagBatchOf(input);
  if (!batch.ok) return err(batch.error);
  const { ids, tags } = batch.value;
  const author = await authorFor(deps, input.actorRef, input.tenantId);
  const now = deps.clock.now();
  return deps.unitOfWork.run(async (tx): Promise<Result<ChangeOrderTagsOutput, DomainError>> => {
    const before = await deps.annotations.annotationsOf(ids, input.tenantId, tx);
    const known = ids.filter((orderId) => before.has(orderId));
    const tooMany = add ? overTheCap(known, before, tags) : new Set<string>();
    // One order (the Tags card): past the cap is the request's own error, nothing written. Bulk: that
    // order is skipped as `too_many_tags` and the others are still tagged (per-order outcomes, §1.4).
    if (ids.length === 1 && tooMany.size > 0) return err(tooManyTagsError());
    let changed: ReadonlyMap<string, readonly string[]> = new Map();
    if (add) {
      const accepted = known.filter((orderId) => !tooMany.has(orderId));
      if (accepted.length > 0) {
        changed = await deps.annotations.addTags(accepted, tags, input.tenantId, tx);
      }
    } else if (known.length > 0) {
      changed = await deps.annotations.removeTags(
        known,
        tags.map((tag) => tag.tagKey),
        input.tenantId,
        tx,
      );
    }
    await recordActivity(
      deps,
      author,
      known
        .filter((orderId) => (changed.get(orderId)?.length ?? 0) > 0)
        .map((orderId): ActivityLine => ({
          orderId,
          kind: add ? "tags_added" : "tags_removed",
          data: { tags: changed.get(orderId) ?? [] },
        })),
      before,
      now,
      input.tenantId,
      tx,
    );
    const after =
      changed.size === 0 ? before : await deps.annotations.annotationsOf(known, input.tenantId, tx);
    const results = ids.map((orderId): OrderTagsResult => {
      const current = after.get(orderId) ?? before.get(orderId);
      if (current === undefined) {
        return { orderId, outcome: "not_found", tags: [], changedTags: [] };
      }
      if (tooMany.has(orderId)) {
        return { orderId, outcome: "too_many_tags", tags: current.tags, changedTags: [] };
      }
      const changedTags = changed.get(orderId) ?? [];
      return {
        orderId,
        outcome: changedTags.length > 0 ? "changed" : "unchanged",
        tags: current.tags,
        changedTags,
      };
    });
    return ok({ results });
  });
}

/** Shopify's Tags card and the bulk "Add tags" (spec §2.2). Idempotent per tag key. */
export class AddOrderTags implements UseCase<
  ChangeOrderTagsInput,
  ChangeOrderTagsOutput,
  DomainError
> {
  private readonly deps: OrderAnnotationsDeps;

  constructor(deps: OrderAnnotationsDeps) {
    this.deps = deps;
  }

  execute(input: ChangeOrderTagsInput): Promise<Result<ChangeOrderTagsOutput, DomainError>> {
    return changeTags(this.deps, input, true);
  }
}

/** The tag chip's × and the bulk "Remove tags" (case-insensitive). */
export class RemoveOrderTags implements UseCase<
  ChangeOrderTagsInput,
  ChangeOrderTagsOutput,
  DomainError
> {
  private readonly deps: OrderAnnotationsDeps;

  constructor(deps: OrderAnnotationsDeps) {
    this.deps = deps;
  }

  execute(input: ChangeOrderTagsInput): Promise<Result<ChangeOrderTagsOutput, DomainError>> {
    return changeTags(this.deps, input, false);
  }
}

export interface SuggestOrderTagsInput {
  readonly tenantId: string;
  readonly prefix?: string;
  readonly limit?: number;
}

export interface SuggestOrderTagsOutput {
  readonly tags: readonly TagUsage[];
}

/** The tag input's suggestions (`GET /order-tags`): the shop's tags by literal prefix, most used first. */
export class SuggestOrderTags implements UseCase<
  SuggestOrderTagsInput,
  SuggestOrderTagsOutput,
  DomainError
> {
  private readonly deps: Pick<OrderAnnotationsDeps, "annotations">;

  constructor(deps: Pick<OrderAnnotationsDeps, "annotations">) {
    this.deps = deps;
  }

  async execute(
    input: SuggestOrderTagsInput,
  ): Promise<Result<SuggestOrderTagsOutput, DomainError>> {
    const prefix = normalizeTag(input.prefix ?? "");
    if (characterCount(prefix) > MAX_TAG_LENGTH) return ok({ tags: [] });
    const limit = clampSuggestionLimit(input.limit ?? TAG_SUGGESTION_LIMIT);
    return ok({ tags: await this.deps.annotations.tagsInUse(input.tenantId, prefix, limit) });
  }
}
