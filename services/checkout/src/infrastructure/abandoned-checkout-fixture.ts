import { UniqueEntityId } from "@platform/domain";
import type { Result } from "@platform/types";
import { abandonedBefore, type AbandonedCheckoutQuery } from "../domain/abandoned-checkouts";
import { CheckoutSession } from "../domain/checkout-session";
import { CheckoutAddress } from "../domain/value-objects/checkout-address";
import { CheckoutItem } from "../domain/value-objects/checkout-item";
import { ContactEmail } from "../domain/value-objects/contact-email";

/**
 * TEST-ONLY (order operations Part 3). One set of sessions — every case the abandoned definition keeps
 * or drops — that the in-memory store (unit test) and the Prisma store (integration test) must list
 * identically. Ids come from the caller so the integration run can use fresh UUIDs each time.
 */
export const FIXTURE_NOW = new Date("2026-10-18T12:00:00.000Z");
export const FIXTURE_OLDER_THAN = abandonedBefore(FIXTURE_NOW);
const IDLE = new Date("2026-10-18T10:00:00.000Z");
const FRESH = new Date("2026-10-18T11:30:00.000Z");

export const FIXTURE_NAMES = [
  "emailOnly",
  "phoneOnly",
  "locked",
  "recovered",
  "completed",
  "failed",
  "expired",
  "fresh",
  "noContact",
  "noItems",
  "draft",
  "otherTenant",
] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];
export type FixtureIds = Readonly<Record<FixtureName, string>>;

export interface AbandonedFixtureStore {
  /** Saves the session as last changed at `updatedAt`. */
  save(session: CheckoutSession, tenantId: string, updatedAt: Date): Promise<void>;
}

function must<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function open(
  id: string,
  name: FixtureName,
  options: { email?: string; phone?: string; recipient?: string; items?: boolean },
): CheckoutSession {
  const session = CheckoutSession.start(
    UniqueEntityId.from(id),
    `cart-${name}`,
    undefined,
    `session-${name}`,
    "EGP",
  );
  if (options.items !== false) {
    session.loadItems([must(CheckoutItem.create("product-1", 1, 1000, "EGP"))]);
  }
  if (options.email !== undefined)
    session.setContactEmail(must(ContactEmail.create(options.email)));
  if (options.phone !== undefined || options.recipient !== undefined) {
    session.setShippingAddress(
      must(
        CheckoutAddress.create({
          name: options.recipient,
          phone: options.phone,
          line1: "5 Nile St",
          city: "Cairo",
          postalCode: "",
          country: "EG",
        }),
      ),
    );
  }
  return session;
}

export async function seedAbandonedFixture(
  store: AbandonedFixtureStore,
  tenants: { readonly tenantId: string; readonly otherTenantId: string },
  newId: () => string,
): Promise<FixtureIds> {
  const ids = Object.fromEntries(FIXTURE_NAMES.map((name) => [name, newId()])) as Record<
    FixtureName,
    string
  >;
  const at = new Date(0);
  const emailOnly = open(ids.emailOnly, "emailOnly", { email: "Sara@Example.com" });
  const phoneOnly = open(ids.phoneOnly, "phoneOnly", {
    phone: "01001234567",
    recipient: "Mona Ali",
  });
  const locked = open(ids.locked, "locked", { email: "ali@example.com", recipient: "Ahmed" });
  locked.lock(newId(), at);
  const recovered = open(ids.recovered, "recovered", { email: "omar@example.com" });
  recovered.markRecovered("order-recovered", newId(), at);
  const completed = open(ids.completed, "completed", { email: "done@example.com" });
  completed.complete("order-completed", newId(), at);
  const failed = open(ids.failed, "failed", { email: "failed@example.com" });
  failed.fail("declined", newId(), at);
  const expired = open(ids.expired, "expired", { email: "gone@example.com" });
  expired.expire(newId(), at);
  const fresh = open(ids.fresh, "fresh", { email: "fresh@example.com" });
  const noContact = open(ids.noContact, "noContact", { recipient: "No Phone" });
  const noItems = open(ids.noItems, "noItems", { email: "empty@example.com", items: false });
  // Part 4 (spec §3.1, draft_terms = '{}'): a draft order's checkout is the draft list's, never listed here.
  const draft = open(ids.draft, "draft", { email: "draft@example.com" });
  draft.applyDraftTerms({
    draftOrderRef: "draft-fixture",
    draftNumber: "D1",
    shipping: { title: "Courier", amountMinor: 0 },
  });
  const otherTenant = open(ids.otherTenant, "otherTenant", { email: "sara@example.com" });

  const own: readonly (readonly [CheckoutSession, Date])[] = [
    [emailOnly, IDLE],
    [phoneOnly, IDLE],
    [locked, IDLE],
    [recovered, FRESH],
    [completed, IDLE],
    [failed, IDLE],
    [expired, IDLE],
    [fresh, FRESH],
    [noContact, IDLE],
    [noItems, IDLE],
    [draft, IDLE],
  ];
  for (const [session, updatedAt] of own) await store.save(session, tenants.tenantId, updatedAt);
  await store.save(otherTenant, tenants.otherTenantId, IDLE);
  return ids;
}

export interface AbandonedFixtureCase {
  readonly name: string;
  readonly query: Omit<AbandonedCheckoutQuery, "olderThan">;
  readonly expected: readonly FixtureName[];
}

const LISTED: readonly FixtureName[] = ["emailOnly", "phoneOnly", "locked", "recovered"];

export const ABANDONED_FIXTURE_CASES: readonly AbandonedFixtureCase[] = [
  {
    name: "lists idle open sessions with an email or a phone, plus recovered ones — nothing else",
    query: {},
    expected: LISTED,
  },
  {
    name: "search matches the email, case-insensitively",
    query: { search: "SARA@" },
    expected: ["emailOnly"],
  },
  {
    name: "search matches the recipient's name",
    query: { search: "mona" },
    expected: ["phoneOnly"],
  },
  { name: "search matches the phone", query: { search: "0100123" }, expected: ["phoneOnly"] },
  { name: "a search with % is taken literally", query: { search: "%" }, expected: [] },
  { name: "recovered only", query: { recovery: "recovered" }, expected: ["recovered"] },
  {
    name: "not recovered only",
    query: { recovery: "not_recovered" },
    expected: ["emailOnly", "phoneOnly", "locked"],
  },
];

/** The ids of `names` in the list's order (id descending). */
export function expectedIds(ids: FixtureIds, names: readonly FixtureName[]): string[] {
  return names
    .map((name) => ids[name])
    .sort()
    .reverse();
}

export const FIXTURE_LISTED: readonly FixtureName[] = LISTED;
