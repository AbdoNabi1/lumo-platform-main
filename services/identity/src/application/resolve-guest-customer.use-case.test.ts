import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { ConflictError } from "@platform/utils";
import { wireIdentity } from "../composition";
import type { Customer } from "../domain/customer";
import type { CustomerRepository } from "../domain/customer-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { ResolveGuestCustomer } from "./resolve-guest-customer.use-case";

const clock: Clock = { now: () => new Date("2026-09-21T00:00:00.000Z") };

function wire() {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  return wireIdentity({ serializer: new InMemoryEventSerializer(), idGenerator, clock });
}

interface Resolved {
  readonly customerId: string;
  readonly created: boolean;
}

async function resolve(
  app: ReturnType<typeof wire>,
  email: string,
  tenantId = "tenant-a",
  name = "guest",
) {
  return app.customers.resolveGuestCustomer({ email, name, tenantId });
}

const unusedList = async (): Promise<never> => {
  throw new Error("not used");
};

describe("ResolveGuestCustomer", () => {
  it("creates a guest customer for an unknown email", async () => {
    const app = wire();

    const response = await resolve(app, "New@Example.com");

    expect(response.status).toBe(200);
    const { customerId, created } = response.body as Resolved;
    expect(created).toBe(true);
    const fetched = await app.customers.getCustomer({ tenantId: "tenant-a", customerId });
    expect(fetched.status).toBe(200);
    const customer = fetched.body as Customer;
    expect(customer.isGuest).toBe(true);
    expect(customer.email.value).toBe("new@example.com");
  });

  it("creates NO consent record for a guest — placing an order is not an opt-in", async () => {
    const app = wire();
    const { customerId } = (await resolve(app, "g@example.com")).body as Resolved;

    const customer = (await app.customers.getCustomer({ tenantId: "tenant-a", customerId }))
      .body as Customer;

    expect(customer.consents).toHaveLength(0);
  });

  it("a returning guest reusing the same email resolves to the same customer id", async () => {
    const app = wire();
    const first = (await resolve(app, "again@example.com")).body as Resolved;
    const second = (await resolve(app, "AGAIN@example.com ")).body as Resolved;

    expect(second.customerId).toBe(first.customerId);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
  });

  it("an already-registered customer resolves to the existing id and is NOT downgraded to a guest", async () => {
    const app = wire();
    const registered = await app.customers.register({
      email: "real@example.com",
      name: "Real Person",
      tenantId: "tenant-a",
    });
    const realId = (registered.body as { customerId: string }).customerId;

    const resolved = (await resolve(app, "real@example.com")).body as Resolved;

    expect(resolved.customerId).toBe(realId);
    expect(resolved.created).toBe(false);
    const customer = (await app.customers.getCustomer({ tenantId: "tenant-a", customerId: realId }))
      .body as Customer;
    expect(customer.isGuest).toBe(false);
    expect(customer.name).toBe("Real Person");
  });

  it("emits customer.registered only when it creates — never for an existing customer", async () => {
    const app = wire();

    await resolve(app, "once@example.com"); // create
    await resolve(app, "once@example.com"); // find
    await resolve(app, "once@example.com"); // find
    await app.drainOutbox();

    expect(
      app.deliveredEventTypes.filter((t) => t === "identity.customer.registered"),
    ).toHaveLength(1);
  });

  it("the same email in two tenants resolves to two DIFFERENT customer ids (ADR-0014)", async () => {
    const app = wire();

    const inA = (await resolve(app, "shared@example.com", "tenant-a")).body as Resolved;
    const inB = (await resolve(app, "shared@example.com", "tenant-b")).body as Resolved;

    expect(inB.customerId).not.toBe(inA.customerId);
    expect(inA.created).toBe(true);
    expect(inB.created).toBe(true); // tenant B did not find tenant A's customer
    // ...and neither tenant can read the other's customer by id.
    const cross = await app.customers.getCustomer({
      tenantId: "tenant-b",
      customerId: inA.customerId,
    });
    expect(cross.status).toBe(404);
  });

  it("rejects an invalid email with a 422 and creates nothing", async () => {
    const app = wire();
    const response = await resolve(app, "not-an-email");
    expect(response.status).toBe(422);
  });

  it("rejects an empty name", async () => {
    const app = wire();
    const response = await resolve(app, "a@example.com", "tenant-a", "  ");
    expect(response.status).toBe(422);
  });
});

/**
 * The concurrent-create race: two guest checkouts with the same email in the same tenant can both
 * read "nothing there" and both try to create; `@@unique([tenantId, email])` makes the second one
 * fail. That failure must resolve to the winner's id, not surface as a 500 at the last step of
 * checkout. Postgres aborts the whole transaction on the violation, so the recovery read has to
 * run in a FRESH unit of work — the counting unit of work below records how many were opened.
 */
describe("ResolveGuestCustomer — concurrent create race", () => {
  it("on a unique violation from create, re-finds and returns the winner's id", async () => {
    const app = wire();
    // The winner: another request already created this customer.
    const winner = (await resolve(app, "race@example.com")).body as Resolved;
    const winnerCustomer = (
      await app.customers.getCustomer({ tenantId: "tenant-a", customerId: winner.customerId })
    ).body as Customer;

    // The loser: its first read predates the winner's commit (stale → null), its create hits the
    // unique constraint, and only a later read sees the winner.
    let reads = 0;
    let saves = 0;
    const racing: CustomerRepository = {
      async findByEmail() {
        reads += 1;
        return reads === 1 ? null : winnerCustomer;
      },
      async save() {
        saves += 1;
        throw new ConflictError("unique (tenant_id, email)");
      },
      findById: async () => null,
      list: unusedList,
    };
    let units = 0;
    const inner = new InMemoryUnitOfWork();
    const countingUow = {
      run: <T>(work: (tx: unknown) => Promise<T>) => {
        units += 1;
        return inner.run(work);
      },
    };
    let n = 100;
    const useCase = new ResolveGuestCustomer({
      customers: racing,
      unitOfWork: countingUow,
      idGenerator: { generate: () => `loser-${(n += 1)}` },
      clock,
    });

    const result = await useCase.execute({
      email: "race@example.com",
      name: "guest",
      tenantId: "tenant-a",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toEqual({ customerId: winner.customerId, created: false });
    expect(saves).toBe(1);
    expect(reads).toBe(2);
    expect(units).toBe(2); // the recovery read ran in a fresh unit of work
  });

  it("propagates a non-conflict failure from create untouched", async () => {
    const failing: CustomerRepository = {
      findByEmail: async () => null,
      save: async () => {
        throw new Error("connection reset");
      },
      findById: async () => null,
      list: unusedList,
    };
    const useCase = new ResolveGuestCustomer({
      customers: failing,
      unitOfWork: new InMemoryUnitOfWork(),
      idGenerator: { generate: () => "x" },
      clock,
    });

    await expect(
      useCase.execute({ email: "a@example.com", name: "guest", tenantId: "tenant-a" }),
    ).rejects.toThrow("connection reset");
  });

  it("returns the conflict when the recovery read still finds nothing", async () => {
    const stuck: CustomerRepository = {
      findByEmail: async () => null,
      save: async () => {
        throw new ConflictError("unique (tenant_id, email)");
      },
      findById: async () => null,
      list: unusedList,
    };
    const useCase = new ResolveGuestCustomer({
      customers: stuck,
      unitOfWork: new InMemoryUnitOfWork(),
      idGenerator: { generate: () => "x" },
      clock,
    });

    const result = await useCase.execute({
      email: "a@example.com",
      name: "guest",
      tenantId: "tenant-a",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected err");
    expect(result.error.code).toBe("CONFLICT");
  });
});
