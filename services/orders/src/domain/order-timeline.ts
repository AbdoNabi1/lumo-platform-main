import { err, ok, type Result } from "@platform/types";
import { ValidationError } from "@platform/utils";
import { characterCount } from "./order-tags";

/** What one timeline line is (order operations spec §2.1) — mirrored by the migration's CHECK. */
export const ORDER_TIMELINE_KINDS = [
  "comment",
  "archived",
  "unarchived",
  "note_changed",
  "tags_added",
  "tags_removed",
  "created_from_draft",
] as const;
export type OrderTimelineKind = (typeof ORDER_TIMELINE_KINDS)[number];
/** Activity lines: written by the annotation use cases, never editable. */
export type OrderActivityKind = Exclude<OrderTimelineKind, "comment">;

export const MAX_COMMENT_LENGTH = 5000;
/** The order page shows the latest this-many entries (spec §2.3). */
export const TIMELINE_READ_LIMIT = 200;

/** The small structured payload of an activity line. */
export interface OrderTimelineData {
  /** tags_added / tags_removed: the tags actually added or removed, as spelled. */
  readonly tags?: readonly string[];
  /** note_changed: true when the note was removed. */
  readonly cleared?: boolean;
  /** created_from_draft (Part 4): "D3". */
  readonly draftNumber?: string;
  /** created_from_draft (Part 4, Ruling 24): the draft's id, for the order page's back-link. */
  readonly draftId?: string;
}

/**
 * One line of an order's staff timeline. Outside the `Order` aggregate. `authorName` is a snapshot
 * taken at write time (renaming a staff member never rewrites history). A deleted comment keeps its
 * row and body for the audit trail; the API never serves that body again.
 */
export interface OrderTimelineEntry {
  readonly id: string;
  readonly orderId: string;
  readonly kind: OrderTimelineKind;
  /** The staff principal id; null for a system line. */
  readonly authorRef: string | null;
  readonly authorName: string | null;
  /** The comment text (kind = comment); null for activity. */
  readonly body: string | null;
  readonly data: OrderTimelineData;
  readonly createdAt: Date;
  readonly editedAt: Date | null;
  readonly deletedAt: Date | null;
}

export function isOrderTimelineKind(value: string): value is OrderTimelineKind {
  return (ORDER_TIMELINE_KINDS as readonly string[]).includes(value);
}

/** A comment as stored: ends trimmed, inner line breaks kept; never blank; ≤ 5,000 characters. */
export function normalizeCommentBody(raw: string): Result<string, ValidationError> {
  const body = raw.normalize("NFC").trim();
  if (body.length === 0) {
    return err(
      new ValidationError("Write a comment first", [{ field: "body", message: "is empty" }]),
    );
  }
  if (characterCount(body) > MAX_COMMENT_LENGTH) {
    return err(
      new ValidationError(`A comment can have at most ${MAX_COMMENT_LENGTH} characters`, [
        { field: "body", message: `must be at most ${MAX_COMMENT_LENGTH} characters` },
      ]),
    );
  }
  return ok(body);
}

/** Persistence port for {@link OrderTimelineEntry}. ADR-0014: `tenantId` per call; writes need the unit of work's `tx`. */
export interface OrderTimelineRepository {
  append(entry: OrderTimelineEntry, tenantId: string, tx?: unknown): Promise<void>;
  /** This shop's entries of one order, newest first, at most `first` (≤ {@link TIMELINE_READ_LIMIT}). */
  listForOrder(
    orderId: string,
    tenantId: string,
    options: { readonly first: number },
    tx?: unknown,
  ): Promise<readonly OrderTimelineEntry[]>;
  /** One entry of this shop by id; null for an unknown id or another shop's entry. */
  findById(entryId: string, tenantId: string, tx?: unknown): Promise<OrderTimelineEntry | null>;
  /** Writes ONLY `body`, `editedAt` and `deletedAt` of an existing entry of this shop (an edit or a soft delete). */
  update(entry: OrderTimelineEntry, tenantId: string, tx?: unknown): Promise<void>;
}
