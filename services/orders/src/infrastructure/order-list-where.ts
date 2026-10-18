import type { Prisma } from "@prisma/client";
import { normalizePageSize } from "@platform/repository";
import { ORDER_LIST_MAX_PAGE_SIZE, type OrderListQuery } from "../domain/order-repository";
import { phoneSearchNeedles } from "../domain/order-search";
import {
  NOT_OPEN_EVENT_TYPES,
  ORDER_ENTRY_EVENT_TYPES,
  PAYMENT_DECIDED_EVENT_TYPES,
} from "../domain/order-statuses";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INSENSITIVE = "insensitive" as const;

/** How many shipping addresses one search may match (spec §1.3); their order ids are OR'd into the list. */
export const RECIPIENT_SEARCH_CAP = 500;

/**
 * The ids a `uuid` column can actually hold, deduped. Anything else can match no row, and sending it
 * would make Postgres fail the whole query ("invalid input syntax for type uuid").
 */
export function uuidsOf(ids: readonly string[]): string[] {
  return [...new Set(ids)].filter((id) => UUID_PATTERN.test(id));
}

/** Like `normalizePageSize`, but an order export page may hold up to {@link ORDER_LIST_MAX_PAGE_SIZE}. */
export function orderPageSize(first: number | undefined): number {
  if (first === undefined) return normalizePageSize(undefined);
  return Math.max(1, Math.min(Math.trunc(first), ORDER_LIST_MAX_PAGE_SIZE));
}

/** The recipient half of a search, on `order_shipping_addresses`: the name, or the phone in each typed form. */
export function recipientSearchWhere(
  search: string,
  tenantId: string,
): Prisma.OrderShippingAddressWhereInput {
  const text = search.trim();
  return {
    tenantId,
    OR: [
      { recipientName: { contains: text, mode: INSENSITIVE } },
      ...phoneSearchNeedles(text).map((needle) => ({ phone: { contains: needle } })),
    ],
  };
}

/**
 * The `orders` WHERE for one list read. Every tab predicate is a relation filter Prisma emits as
 * `EXISTS`/`NOT EXISTS` over `order_events`, built from the same event-type sets the pure functions
 * read — exact pages, no scan cap. `recipientOrderIds` is the first step of the two-step recipient
 * search (see {@link recipientSearchWhere}).
 */
export function orderListWhere(
  query: OrderListQuery,
  tenantId: string,
  after: string | undefined,
  recipientOrderIds: readonly string[],
): Prisma.OrderWhereInput {
  const and: Prisma.OrderWhereInput[] = [];
  if (query.open !== undefined) {
    const blocking = { type: { in: [...NOT_OPEN_EVENT_TYPES] } };
    and.push(query.open ? { events: { none: blocking } } : { events: { some: blocking } });
  }
  if (query.paymentStatus === "pending") {
    and.push({ events: { none: { type: { in: [...PAYMENT_DECIDED_EVENT_TYPES] } } } });
  }
  if (query.createdFrom !== undefined || query.createdTo !== undefined) {
    and.push({
      events: {
        some: {
          type: { in: [...ORDER_ENTRY_EVENT_TYPES] },
          occurredAt: {
            ...(query.createdFrom === undefined ? {} : { gte: query.createdFrom }),
            ...(query.createdTo === undefined ? {} : { lt: query.createdTo }),
          },
        },
      },
    });
  }

  const id: { lt?: string; in?: string[] } = {};
  if (after !== undefined) id.lt = after;
  if (query.ids !== undefined) id.in = uuidsOf(query.ids);

  const search = query.search?.trim() ?? "";
  return {
    tenantId,
    ...(id.lt !== undefined || id.in !== undefined ? { id } : {}),
    ...(query.archived === undefined ? {} : { archivedAt: query.archived ? { not: null } : null }),
    ...(search.length > 0
      ? {
          OR: [
            { orderNumber: { contains: search, mode: INSENSITIVE } },
            { customerRef: { contains: search, mode: INSENSITIVE } },
            ...(recipientOrderIds.length > 0 ? [{ id: { in: [...recipientOrderIds] } }] : []),
          ],
        }
      : {}),
    ...(and.length > 0 ? { AND: and } : {}),
  };
}
