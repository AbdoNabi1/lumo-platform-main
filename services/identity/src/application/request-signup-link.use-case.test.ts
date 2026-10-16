import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { Customer } from "../domain/customer";
import { Email } from "../domain/value-objects/email";
import { IdentityEventTranslator } from "../infrastructure/identity-event-translator";
import { InMemoryCustomerRepository } from "../infrastructure/in-memory-customer-repository";
import { InMemorySignupTokenRepository } from "../infrastructure/in-memory-signup-token-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { NodeTokenPort } from "../infrastructure/node-token-port";
import { RequestSignupLink } from "./request-signup-link.use-case";

const TENANT = "tenant-1";
const NOW = new Date("2026-09-22T00:00:00.000Z");

function build() {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  const clock: Clock = { now: () => NOW };
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new IdentityEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "identity",
  });
  const context = rootEventContext(idGenerator);
  const customers = new InMemoryCustomerRepository({ outbox, context });
  const signupTokens = new InMemorySignupTokenRepository();
  const tokenPort = new NodeTokenPort();
  const unitOfWork = new InMemoryUnitOfWork();
  const useCase = new RequestSignupLink({
    customers,
    signupTokens,
    tokenPort,
    unitOfWork,
    idGenerator,
    clock,
  });
  return { useCase, customers, signupTokens, tokenPort, idGenerator, clock };
}

function email(value: string): Email {
  const result = Email.create(value);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

describe("RequestSignupLink (G-72)", () => {
  it("an unknown email is 'new' — nothing created", async () => {
    const { useCase, signupTokens } = build();
    const result = await useCase.execute({ email: "new@example.com", tenantId: TENANT });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ kind: "new" });
    expect(await signupTokens.findByHash("anything", TENANT)).toBeNull();
  });

  it("an already-registered (non-guest) email is 'already-registered' — no token issued", async () => {
    const { useCase, customers, signupTokens } = build();
    const c = Customer.register(
      UniqueEntityId.from("cust-real"),
      email("real@example.com"),
      "Real",
      "evt-1",
      NOW,
    );
    await customers.save(c, TENANT);

    const result = await useCase.execute({ email: "real@example.com", tenantId: TENANT });
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value).toEqual({ kind: "already-registered", customerId: "cust-real" });
    expect(await signupTokens.findByHash("anything", TENANT)).toBeNull();
  });

  it("a guest email issues a hashed, stored token and returns the raw one", async () => {
    const { useCase, customers, signupTokens, tokenPort } = build();
    const c = Customer.registerGuest(
      UniqueEntityId.from("cust-guest"),
      email("guest@example.com"),
      "Guest",
      "evt-1",
      NOW,
    );
    await customers.save(c, TENANT);

    const result = await useCase.execute({ email: "guest@example.com", tenantId: TENANT });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("guest");
    if (result.value.kind !== "guest") return;
    expect(result.value.customerId).toBe("cust-guest");

    const stored = await signupTokens.findByHash(tokenPort.hash(result.value.token), TENANT);
    expect(stored).not.toBeNull();
    // The raw token itself must never be what's stored (D3).
    expect(await signupTokens.findByHash(result.value.token, TENANT)).toBeNull();
  });

  it("issuing a second token for the same guest invalidates the first (D3)", async () => {
    const { useCase, customers, signupTokens, tokenPort, clock } = build();
    const c = Customer.registerGuest(
      UniqueEntityId.from("cust-guest2"),
      email("guest2@example.com"),
      "Guest",
      "evt-1",
      NOW,
    );
    await customers.save(c, TENANT);

    const first = await useCase.execute({ email: "guest2@example.com", tenantId: TENANT });
    if (!first.ok || first.value.kind !== "guest") throw new Error("expected guest outcome");
    const second = await useCase.execute({ email: "guest2@example.com", tenantId: TENANT });
    if (!second.ok || second.value.kind !== "guest") throw new Error("expected guest outcome");

    const firstStored = await signupTokens.findByHash(tokenPort.hash(first.value.token), TENANT);
    expect(firstStored?.isValid(clock.now())).toBe(false);
    const secondStored = await signupTokens.findByHash(tokenPort.hash(second.value.token), TENANT);
    expect(secondStored?.isValid(clock.now())).toBe(true);
  });

  it("rejects an invalid email", async () => {
    const { useCase } = build();
    const result = await useCase.execute({ email: "not-an-email", tenantId: TENANT });
    expect(result.ok).toBe(false);
  });
});
