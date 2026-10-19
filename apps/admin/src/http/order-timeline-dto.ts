import type { OrderTimelineEntry, OrderTimelineKind } from "@platform/orders";

/** One line of the order page's staff timeline (spec §2.3; `canDelete` added — see the plan's notes). */
export interface TimelineEntryDto {
  readonly id: string;
  readonly kind: OrderTimelineKind;
  /** Snapshotted at write time; null → shown as "Staff". */
  readonly authorName: string | null;
  /** The comment text; null for activity lines and for a deleted comment (never served again). */
  readonly body: string | null;
  readonly data: {
    readonly tags?: readonly string[];
    readonly cleared?: boolean;
    readonly draftNumber?: string;
  };
  readonly createdAt: string;
  readonly editedAt: string | null;
  readonly deleted: boolean;
  /** Decided on the server: only the author edits their own live comment. */
  readonly canEdit: boolean;
  /** The author, or a moderator (admin), may delete a live comment. */
  readonly canDelete: boolean;
}

/** Who is looking: their principal id and whether they may delete others' comments. */
export interface TimelineViewer {
  readonly actorRef: string;
  readonly canModerate: boolean;
}

/**
 * The ONE mapper every route that answers a timeline line goes through (the order detail and the
 * comment POST / PATCH / DELETE responses), so a deleted comment's body is redacted in one place.
 */
export function toTimelineEntryDto(
  entry: OrderTimelineEntry,
  viewer: TimelineViewer,
): TimelineEntryDto {
  const deleted = entry.deletedAt !== null;
  const liveComment = entry.kind === "comment" && !deleted;
  const own = liveComment && entry.authorRef === viewer.actorRef;
  return {
    id: entry.id,
    kind: entry.kind,
    authorName: entry.authorName,
    body: deleted ? null : entry.body,
    data: entry.data,
    createdAt: entry.createdAt.toISOString(),
    editedAt: entry.editedAt?.toISOString() ?? null,
    deleted,
    canEdit: own,
    canDelete: own || (liveComment && viewer.canModerate),
  };
}
