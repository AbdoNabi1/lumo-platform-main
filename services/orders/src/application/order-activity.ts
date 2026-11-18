import type { IdGenerator } from "@platform/contracts";
import { logger } from "@platform/utils";
import type {
  OrderActivityKind,
  OrderTimelineData,
  OrderTimelineEntry,
  OrderTimelineRepository,
} from "../domain/order-timeline";
import type { StaffDirectoryPort } from "./ports";

/** What writing timeline lines needs (order operations Part 2). */
export interface OrderActivityDeps {
  readonly timeline: OrderTimelineRepository;
  readonly staff: StaffDirectoryPort;
  readonly idGenerator: IdGenerator;
}

/** Who did it: the principal id and the name snapshotted at write time. */
export interface ActivityAuthor {
  readonly actorRef: string;
  readonly authorName: string | null;
}

/**
 * The acting staff member's display name, read ONCE per call, before the transaction. An empty or
 * failed lookup is null ("Staff"): the name labels the line, it is never a reason to refuse the action.
 */
export async function authorNameOf(
  staff: StaffDirectoryPort,
  actorRef: string,
  tenantId: string,
): Promise<string | null> {
  try {
    const name = (await staff.displayNameOf(actorRef, tenantId))?.trim() ?? "";
    return name.length > 0 ? name : null;
  } catch (error) {
    logger.warn("staff name lookup failed; the timeline shows Staff", {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** One activity line (never a comment): no body, never edited, never deleted. */
export function activityEntry(
  id: string,
  orderId: string,
  kind: OrderActivityKind,
  author: ActivityAuthor,
  data: OrderTimelineData,
  at: Date,
): OrderTimelineEntry {
  return {
    id,
    orderId,
    kind,
    authorRef: author.actorRef,
    authorName: author.authorName,
    body: null,
    data,
    createdAt: at,
    editedAt: null,
    deletedAt: null,
  };
}
