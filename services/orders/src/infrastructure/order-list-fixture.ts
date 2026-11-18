import { Money, UniqueEntityId } from "@platform/domain";
import { Order } from "../domain/order";
import { OrderEvent, type OrderEventType } from "../domain/order-event";
import { OrderItem } from "../domain/order-item";
import type { OrderListQuery } from "../domain/order-repository";
import { AddressSnapshot } from "../domain/value-objects/address-snapshot";
import { OrderNumber } from "../domain/value-objects/order-number";
import { ProductSnapshot } from "../domain/value-objects/product-snapshot";

/**
 * Order operations Part 1 — ONE fixture and ONE list of expectations that both `InMemoryOrderRepository`
 * and `PrismaOrderRepository` (integration) must satisfy, so the tab predicates cannot drift apart.
 */
export type ListFixtureKey =
  | "openUnpaid"
  | "codPending"
  | "paid"
  | "paymentReceived"
  | "refunded"
  | "cancelled"
  | "closedUnpaid"
  | "archivedUnpaid";

interface PlannedOrder {
  readonly key: ListFixtureKey;
  readonly events: readonly OrderEventType[];
  readonly paymentRef?: string;
  readonly recipient?: { readonly name: string; readonly phone: string };
}

const PLAN: readonly PlannedOrder[] = [
  {
    key: "openUnpaid",
    events: ["created", "confirmed", "awaiting_payment"],
    recipient: { name: "Mona Ali", phone: "+201012345678" },
  },
  {
    key: "codPending",
    events: ["created", "confirmed", "awaiting_payment", "payment_requested"],
    paymentRef: "cod-intent",
  },
  { key: "paid", events: ["placed", "paid"] },
  {
    key: "paymentReceived",
    events: ["created", "confirmed", "awaiting_payment", "payment_requested", "payment_received"],
  },
  { key: "refunded", events: ["placed", "paid", "refunded"] },
  { key: "cancelled", events: ["placed", "cancelled"] },
  { key: "closedUnpaid", events: ["created", "confirmed", "closed"] },
  { key: "archivedUnpaid", events: ["created", "confirmed", "awaiting_payment"] },
];

export const ARCHIVED_FIXTURE_KEYS: readonly ListFixtureKey[] = ["archivedUnpaid"];

/** Part 2: the tags each fixture order carries, as typed (the filter is case-insensitive). */
export const TAGGED_FIXTURE: Readonly<Partial<Record<ListFixtureKey, readonly string[]>>> = {
  openUnpaid: ["VIP", "Urgent"],
  paid: ["vip"],
  cancelled: ["urgent"],
};

const DAY = 86_400_000;
/** Order N of the plan is placed N days after this instant (index 2 = "paid" on Oct 3, 10:00 UTC). */
export const FIXTURE_START = new Date("2026-10-01T10:00:00.000Z");
const dayAfterStart = (days: number) => new Date(FIXTURE_START.getTime() + days * DAY);

function must<T>(result: { ok: boolean; value?: T }): T {
  if (!result.ok || result.value === undefined) throw new Error("order list fixture: invalid VO");
  return result.value;
}

export interface ListFixtureOrder {
  readonly key: ListFixtureKey;
  readonly order: Order;
}

/** Builds the plan as version-0 aggregates with exactly the planned history (reconstitute validates no transitions). */
export function buildListFixture(nextId: () => string): readonly ListFixtureOrder[] {
  return PLAN.map((plan, index) => {
    const placedAt = dayAfterStart(index);
    const item = OrderItem.create(
      UniqueEntityId.from(nextId()),
      must(ProductSnapshot.create(nextId(), "Toy", must(Money.create(1000, "EGP")))),
      1,
    );
    const address = must(
      AddressSnapshot.create(
        "1 Nile St",
        "Cairo",
        "11511",
        "EG",
        plan.recipient === undefined
          ? undefined
          : { recipientName: plan.recipient.name, phone: plan.recipient.phone },
      ),
    );
    const history = plan.events.map((type, step) =>
      OrderEvent.create(
        UniqueEntityId.from(nextId()),
        type,
        new Date(placedAt.getTime() + step * 60_000),
      ),
    );
    const order = Order.reconstitute(
      UniqueEntityId.from(nextId()),
      must(OrderNumber.create(String(1001 + index))),
      `customer-${plan.key}`,
      "EGP",
      [item],
      address,
      history,
      0,
      plan.paymentRef === undefined ? {} : { paymentRef: plan.paymentRef },
    );
    return { key: plan.key, order };
  });
}

export interface OrderListCase {
  readonly name: string;
  readonly query: (idOf: (key: ListFixtureKey) => string) => OrderListQuery;
  readonly expected: readonly ListFixtureKey[];
}

const ALL_KEYS = PLAN.map((plan) => plan.key);

export const ORDER_LIST_CASES: readonly OrderListCase[] = [
  { name: "no filter lists every order, archived included", query: () => ({}), expected: ALL_KEYS },
  {
    name: "archived: true lists only archived orders",
    query: () => ({ archived: true }),
    expected: ["archivedUnpaid"],
  },
  {
    name: "archived: false hides archived orders",
    query: () => ({ archived: false }),
    expected: ALL_KEYS.filter((key) => key !== "archivedUnpaid"),
  },
  {
    name: "open: true drops cancelled and closed orders",
    query: () => ({ open: true }),
    expected: ["openUnpaid", "codPending", "paid", "paymentReceived", "refunded", "archivedUnpaid"],
  },
  {
    name: "paymentStatus pending is derivePaymentStatus's pending (closed-but-unpaid included)",
    query: () => ({ paymentStatus: "pending" }),
    expected: ["openUnpaid", "codPending", "closedUnpaid", "archivedUnpaid"],
  },
  {
    name: "the Unpaid tab: open, payment pending, not archived",
    query: () => ({ open: true, paymentStatus: "pending", archived: false }),
    expected: ["openUnpaid", "codPending"],
  },
  {
    name: "the Open tab: open, not archived",
    query: () => ({ open: true, archived: false }),
    expected: ["openUnpaid", "codPending", "paid", "paymentReceived", "refunded"],
  },
  {
    name: "ids narrows to the selection",
    query: (idOf) => ({ ids: [idOf("paid"), idOf("cancelled")] }),
    expected: ["paid", "cancelled"],
  },
  {
    name: "ids that name no order match nothing (and never break the query)",
    query: () => ({ ids: ["not-a-uuid", "00000000-0000-7000-8000-ffffffffffff"] }),
    expected: [],
  },
  {
    name: "createdFrom is inclusive and createdTo exclusive, on the first event's time",
    query: () => ({ createdFrom: dayAfterStart(2), createdTo: dayAfterStart(4) }),
    expected: ["paid", "paymentReceived"],
  },
  {
    name: "search matches the recipient's name",
    query: () => ({ search: "mona" }),
    expected: ["openUnpaid"],
  },
  {
    name: "search matches the phone typed with the national leading 0",
    query: () => ({ search: "010 1234 5678" }),
    expected: ["openUnpaid"],
  },
  {
    name: "search still matches the order number",
    query: () => ({ search: "1003" }),
    expected: ["paid"],
  },
  {
    name: "tags matches a tag case-insensitively (Part 2)",
    query: () => ({ tags: ["Vip"] }),
    expected: ["openUnpaid", "paid"],
  },
  {
    name: "several tags must all match (AND)",
    query: () => ({ tags: ["vip", "URGENT"] }),
    expected: ["openUnpaid"],
  },
  {
    name: "a tag no order carries matches nothing",
    query: () => ({ tags: ["nobody"] }),
    expected: [],
  },
  {
    name: "the tag filter combines with a tab's predicates",
    query: () => ({ tags: ["urgent"], open: true }),
    expected: ["openUnpaid"],
  },
];
