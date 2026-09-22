import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { NotFoundError } from "@platform/utils";
import { Customer } from "../domain/customer";
import { Email } from "../domain/value-objects/email";
import { IdentityEventTranslator } from "../infrastructure/identity-event-translator";
import { InMemoryCustomerRepository } from "../infrastructure/in-memory-customer-repository";
import { InMemorySignupTokenRepository } from "../infrastructure/in-memory-signup-token-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { NodeTokenPort } from "../infrastructure/node-token-port";
import { CompleteSignup } from "./complete-signup.use-case";
import { RequestSignupLink } from "./request-signup-link.use-case";

const TENANT = "tenant-1";
const NOW = new Date("2026-09-22T00:00:00.000Z");

function email(value: string): Email {
  const result = Email.create(value);
  if (!result.ok) throw new Error("invalid fixture");
  return result.value;
}

function build(nowOverride?: { current: Date }) {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  const clock: Clock = { now: () => nowOverride?.current ?? NOW };
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
  const requestSignupLink = new RequestSignupLink({
    customers,
    signupTokens,
    tokenPort,
    unitOfWork,
    idGenerator,
    clock,
  });
  const completeSignup = new CompleteSignup({
    customers,
    signupTokens,
    tokenPort,
    unitOfWork,
    clock,
  });
  return { requestSignupLink, completeSignup, customers, signupTokens, clock };
}

async function issueGuestToken(
  deps: ReturnType<typeof build>,
  emailValue: string,
  customerId: string,
): Promise<string> {
  const c = Customer.registerGuest(
    UniqueEntityId.from(customerId),
    email(emailValue),
    "Guest",
    "evt-1",
    NOW,
  );
  await deps.customers.save(c, TENANT);
  const result = await deps.requestSignupLink.execute({ email: emailValue, tenantId: TENANT });
  if (!result.ok || result.value.kind !== "guest") throw new Error("expected guest outcome");
  return result.value.token;
}

describe("CompleteSignup (G-72)", () => {
  it("upgrades the guest customer and returns its id + email", async () => {
    const deps = build();
    const token = await issueGuestToken(deps, "guest@example.com", "cust-1");

    const result = await deps.completeSignup.execute({
      token,
      name: "Real Name",
      tenantId: TENANT,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ customerId: "cust-1", email: "guest@example.com" });

    const upgraded = await deps.customers.findById("cust-1", TENANT);
    expect(upgraded?.isGuest).toBe(false);
    expect(upgraded?.emailVerifiedAt).toEqual(NOW);
    expect(upgraded?.name).toBe("Real Name");
  });

  it("consumes the token — a second completion with the same token fails", async () => {
    const deps = build();
    const token = await issueGuestToken(deps, "guest2@example.com", "cust-2");

    const first = await deps.completeSignup.execute({ token, name: "A", tenantId: TENANT });
    expect(first.ok).toBe(true);
    const second = await deps.completeSignup.execute({ token, name: "B", tenantId: TENANT });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBeInstanceOf(NotFoundError);
  });

  it("rejects an unknown token", async () => {
    const deps = build();
    const result = await deps.completeSignup.execute({
      token: "never-issued",
      name: "A",
      tenantId: TENANT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(NotFoundError);
  });

  it("rejects an expired token", async () => {
    const clockState = { current: NOW };
    const deps = build(clockState);
    const token = await issueGuestToken(deps, "guest3@example.com", "cust-3");

    clockState.current = new Date(NOW.getTime() + 25 * 60 * 60 * 1000); // 25h later, past 24h TTL
    const result = await deps.completeSignup.execute({ token, name: "A", tenantId: TENANT });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(NotFoundError);
  });

  it("rejects a token issued for a different tenant", async () => {
    const deps = build();
    const c = Customer.registerGuest(
      UniqueEntityId.from("cust-4"),
      email("guest4@example.com"),
      "Guest",
      "evt-1",
      NOW,
    );
    await deps.customers.save(c, "tenant-A");
    const requested = await deps.requestSignupLink.execute({
      email: "guest4@example.com",
      tenantId: "tenant-A",
    });
    if (!requested.ok || requested.value.kind !== "guest")
      throw new Error("expected guest outcome");

    const result = await deps.completeSignup.execute({
      token: requested.value.token,
      name: "A",
      tenantId: "tenant-B",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(NotFoundError);
  });

  it("rejects a tampered token", async () => {
    const deps = build();
    const token = await issueGuestToken(deps, "guest5@example.com", "cust-5");
    const tampered = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");

    const result = await deps.completeSignup.execute({
      token: tampered,
      name: "A",
      tenantId: TENANT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(NotFoundError);
  });

  it("every rejection is the same NotFoundError message (indistinguishable)", async () => {
    const deps = build();
    const unknown = await deps.completeSignup.execute({
      token: "bogus",
      name: "A",
      tenantId: TENANT,
    });
    const token = await issueGuestToken(deps, "guest6@example.com", "cust-6");
    await deps.completeSignup.execute({ token, name: "A", tenantId: TENANT });
    const reused = await deps.completeSignup.execute({ token, name: "A", tenantId: TENANT });

    if (unknown.ok || reused.ok) throw new Error("expected both to fail");
    expect(unknown.error.message).toBe(reused.error.message);
  });
});
