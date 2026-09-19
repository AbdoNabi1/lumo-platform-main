import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { CheckoutSession } from "../domain/checkout-session";
import type { CheckoutSessionRepository } from "../domain/checkout-session-repository";
import { GetCheckoutSession } from "./get-checkout-session.use-case";

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

describe("GetCheckoutSession", () => {
  it("returns the session when found", async () => {
    const sessions = new FakeSessionRepository();
    const session = CheckoutSession.start(
      UniqueEntityId.from("cs-1"),
      "cart-1",
      "customer-1",
      "session-1",
      "USD",
    );
    sessions.seed(session);
    const useCase = new GetCheckoutSession({ sessions });

    const result = await useCase.execute({ tenantId: "tenant-a", checkoutSessionId: "cs-1" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.id.toString()).toBe("cs-1");
  });

  it("returns a NotFoundError for an unknown session", async () => {
    const sessions = new FakeSessionRepository();
    const useCase = new GetCheckoutSession({ sessions });

    const result = await useCase.execute({ tenantId: "tenant-a", checkoutSessionId: "missing" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected err");
    expect(result.error.code).toBe("NOT_FOUND");
  });
});
