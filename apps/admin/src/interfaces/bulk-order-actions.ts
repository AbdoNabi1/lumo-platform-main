import type { Permission } from "@platform/contracts";

/** The bulk actions of the Orders list (spec §1.4). Part 2 appends add_tags / remove_tags. */
export const BULK_ORDER_ACTIONS = [
  "archive",
  "unarchive",
  "fulfill",
  "capture_payments",
  "mark_cod_collected",
] as const;
export type BulkOrderAction = (typeof BULK_ORDER_ACTIONS)[number];

/** The permission each action needs — checked ONCE, before any order is touched. Money stays admin-only. */
export const BULK_ACTION_PERMISSIONS: Readonly<Record<BulkOrderAction, Permission>> = {
  archive: "orders:archive",
  unarchive: "orders:archive",
  fulfill: "fulfillment:create",
  capture_payments: "orders:request_payment_capture",
  mark_cod_collected: "payments:confirm_cod_collection",
};
