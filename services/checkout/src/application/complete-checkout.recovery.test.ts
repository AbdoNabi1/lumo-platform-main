import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import { ConcurrencyError } from "@platform/utils";
import { CheckoutSession } from "../domain/checkout-session";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";
import { CheckoutAddress } from "../domain/value-objects/checkout-address";
import { CheckoutItem } from "../domain/value-objects/checkout-item";
import { ContactEmail } from "../domain/value-objects/contact-email";
import {
  CheckoutSessionMapper,
  type CheckoutSessionRow,
} from "../infrastructure/checkout-session.mapper";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import type { OrderCreationPort } from "./ports";
import { CompleteCheckout } from "./complete-checkout.use-case";

const ORIGINAL = "00000000-0000-4000-8000-0000000000a1";
const CLONE = "00000000-0000-4000-8000-0000000000b1";

function must<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok || r.value === undefined) throw new Error("invalid fixture");
  return r.value;
}

/** Copy-on-read like a database: a failed save leaves the stored row untouched. */
class RowSessions implements CheckoutSessionRepository {
  private readonly rows = new Map<string, ReturnType<typeof CheckoutSessionMapper.toRow>>();
  failSaving: string | null = null;

  seed(session: CheckoutSession): void {
    session.pullDomainEvents();
    this.rows.set(session.id.toString(), CheckoutSessionMapper.toRow(session, "t"));
  }

  async save(session: CheckoutSession): Promise<void> {
    if (session.id.toString() === this.failSaving) {
      throw new ConcurrencyError("the original browser changed it");
    }
    session.pullDomainEvents();
    this.rows.set(session.id.toString(), CheckoutSessionMapper.toRow(session, "t"));
  }

  async findById(id: string): Promise<CheckoutSession | null> {
    const row = this.rows.get(id);
    return row === undefined
      ? null
      : CheckoutSessionMapper.toDomain(row as unknown as CheckoutSessionRow);
  }
}

class Orders implements OrderCreationPort {
  calls = 0;
  async create(): Promise<{ readonly orderRef: string }> {
    this.calls += 1;
    return { orderRef: "order-new" };
  }
}

const clock: Clock = { now: () => new Date("2026-10-18T12:00:00.000Z") };
function ids(): IdGenerator {
  let n = 0;
  return { generate: () => `evt-${(n += 1)}` };
}

function original(): CheckoutSession {
  const s = CheckoutSession.start(
    UniqueEntityId.from(ORIGINAL),
    "cart-a",
    undefined,
    "ref-a",
    "EGP",
  );
  s.loadItems([must(CheckoutItem.create("product-1", 1, 1000, "EGP"))]);
  return s;
}

/** `null` = an ordinary checkout (passing `undefined` would take the default). */
function readyClone(recoveredFromRef: string | null = ORIGINAL): CheckoutSession {
  const s = CheckoutSession.start(
    UniqueEntityId.from(CLONE),
    "cart-b",
    undefined,
    "ref-b",
    "EGP",
    recoveredFromRef === null ? {} : { recoveredFromRef },
  );
  const address = must(
    CheckoutAddress.create({ line1: "5 Nile St", city: "Cairo", postalCode: "", country: "EG" }),
  );
  s.loadItems([must(CheckoutItem.create("product-1", 1, 1200, "EGP"))]);
  s.setContactEmail(must(ContactEmail.create("sara@example.com")));
  s.setBillingAddress(address);
  s.setShippingAddress(address);
  s.recalculateTotals("evt-totals", new Date(0));
  return s;
}

function completer(sessions: RowSessions, orders = new Orders()) {
  return new CompleteCheckout({
    sessions,
    unitOfWork: new InMemoryUnitOfWork(),
    idGenerator: ids(),
    clock,
    orderCreation: orders,
  });
}

describe("CompleteCheckout — recovered checkouts (order operations Part 3)", () => {
  it("marks the original recovered and expires it, so its own browser can't also place it", async () => {
    const sessions = new RowSessions();
    sessions.seed(original());
    sessions.seed(readyClone());
    const complete = completer(sessions);

    const result = await complete.execute({
      tenantId: "t",
      checkoutSessionId: CLONE,
      idempotencyKey: "k",
    });
    expect(result.ok).toBe(true);
    const marked = await sessions.findById(ORIGINAL);
    expect(marked?.recoveredOrderRef).toBe("order-new");
    expect(marked?.state.value).toBe("expired");
    const again = await complete.execute({
      tenantId: "t",
      checkoutSessionId: ORIGINAL,
      idempotencyKey: "k2",
    });
    expect(again.ok).toBe(false);
  });

  it("leaves an original its own shopper already placed untouched", async () => {
    const sessions = new RowSessions();
    const placed = original();
    placed.complete("order-own", "evt-own", new Date(0));
    sessions.seed(placed);
    sessions.seed(readyClone());

    const result = await completer(sessions).execute({
      tenantId: "t",
      checkoutSessionId: CLONE,
      idempotencyKey: "k",
    });
    expect(result.ok).toBe(true);
    const own = await sessions.findById(ORIGINAL);
    expect(own?.recoveredOrderRef).toBeUndefined();
    expect(own?.orderRef).toBe("order-own");
  });

  it("completes when the original no longer exists", async () => {
    const sessions = new RowSessions();
    sessions.seed(readyClone());
    const result = await completer(sessions).execute({
      tenantId: "t",
      checkoutSessionId: CLONE,
      idempotencyKey: "k",
    });
    expect(result.ok).toBe(true);
  });

  it("a failure marking the original never undoes the order; a retry marks it (Review Focus 2)", async () => {
    const sessions = new RowSessions();
    sessions.seed(original());
    sessions.seed(readyClone());
    const orders = new Orders();
    const complete = completer(sessions, orders);
    sessions.failSaving = ORIGINAL;

    const first = await complete.execute({
      tenantId: "t",
      checkoutSessionId: CLONE,
      idempotencyKey: "k",
    });
    expect(first.ok && first.value.orderRef).toBe("order-new");
    expect((await sessions.findById(CLONE))?.state.value).toBe("completed");
    expect((await sessions.findById(ORIGINAL))?.recoveredOrderRef).toBeUndefined();

    sessions.failSaving = null;
    const retry = await complete.execute({
      tenantId: "t",
      checkoutSessionId: CLONE,
      idempotencyKey: "k",
    });
    expect(retry.ok && retry.value.orderRef).toBe("order-new");
    expect(orders.calls).toBe(1);
    expect((await sessions.findById(ORIGINAL))?.recoveredOrderRef).toBe("order-new");
  });

  it("an ordinary checkout touches no other session", async () => {
    const sessions = new RowSessions();
    sessions.seed(original());
    sessions.seed(readyClone(null));
    await completer(sessions).execute({
      tenantId: "t",
      checkoutSessionId: CLONE,
      idempotencyKey: "k",
    });
    const untouched = await sessions.findById(ORIGINAL);
    expect(untouched?.recoveredOrderRef).toBeUndefined();
    expect(untouched?.state.value).toBe("started");
  });
});
