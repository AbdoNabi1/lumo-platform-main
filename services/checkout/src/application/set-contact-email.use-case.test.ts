import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { CheckoutSession } from "../domain/checkout-session";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { SetContactEmail } from "./checkout-details.use-cases";

class FakeSessionRepository implements CheckoutSessionRepository {
  private readonly store = new Map<string, CheckoutSession>();

  seed(session: CheckoutSession): void {
    this.store.set(session.id.toString(), session);
  }

  async save(session: CheckoutSession): Promise<void> {
    this.store.set(session.id.toString(), session);
  }

  async findById(id: string): Promise<CheckoutSession | null> {
    return this.store.get(id) ?? null;
  }
}

function setup() {
  const sessions = new FakeSessionRepository();
  const session = CheckoutSession.start(
    UniqueEntityId.from("cs-1"),
    "cart-1",
    undefined,
    "session-1",
    "USD",
  );
  sessions.seed(session);
  return {
    session,
    useCase: new SetContactEmail({ sessions, unitOfWork: new InMemoryUnitOfWork() }),
  };
}

describe("SetContactEmail", () => {
  it("normalises and stores the email on the session", async () => {
    const { session, useCase } = setup();

    const result = await useCase.execute({
      tenantId: "t1",
      checkoutSessionId: "cs-1",
      email: "  Guest@Example.com ",
    });

    expect(result.ok).toBe(true);
    expect(session.contactEmail?.value).toBe("guest@example.com");
  });

  it("rejects an invalid email with a ValidationError and leaves the session untouched", async () => {
    const { session, useCase } = setup();

    const result = await useCase.execute({
      tenantId: "t1",
      checkoutSessionId: "cs-1",
      email: "not-an-email",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected err");
    expect(result.error.code).toBe("VALIDATION");
    expect(session.contactEmail).toBeUndefined();
  });

  it("returns NotFound for an unknown session", async () => {
    const { useCase } = setup();

    const result = await useCase.execute({
      tenantId: "t1",
      checkoutSessionId: "missing",
      email: "a@example.com",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected err");
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("returns a BusinessRuleError once the session is completed", async () => {
    const { session, useCase } = setup();
    session.complete("order-1", "evt-1", new Date(0));

    const result = await useCase.execute({
      tenantId: "t1",
      checkoutSessionId: "cs-1",
      email: "a@example.com",
    });

    expect(result.ok).toBe(false);
  });
});
