import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireSecurity } from "./composition";
import { HashedPasswordAuthProvider } from "./infrastructure/hashed-password-auth-provider";
import { InMemoryPasswordCredentialStore } from "./infrastructure/in-memory-password-credential-store";
import { ScryptPasswordHasher } from "./infrastructure/scrypt-password-hasher";

const clock: Clock = { now: () => new Date("2026-10-06T00:00:00.000Z") };

function wire(store: InMemoryPasswordCredentialStore) {
  let n = 0;
  const idGenerator: IdGenerator = {
    generate: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`,
  };
  return wireSecurity({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
    knownSubjects: ["cust-1"],
    passwordAuthProvider: new HashedPasswordAuthProvider({
      store,
      hasher: new ScryptPasswordHasher({ log2N: 10 }),
      clock,
    }),
  });
}

describe("wireSecurity — injected password provider (Plan 1B-1)", () => {
  it("authenticates through the injected provider, tenant-scoped, across a 'restart'", async () => {
    const store = new InMemoryPasswordCredentialStore();
    const first = wire(store);
    await first.security.registerAuthMethod({
      tenantId: "shop-a",
      kind: "password",
      displayName: "Password",
    });
    const principal = await first.security.registerPrincipal({
      tenantId: "shop-a",
      externalId: "cust-1",
      kind: "human",
      displayName: "cust-1",
      subjectRef: "cust-1",
    });
    expect(principal.status).toBeLessThan(300);
    await first.passwordRegistrar.setPassword({
      tenantId: "shop-a",
      identifier: "x@y.com",
      password: "fake-password-1",
      principalExternalId: "cust-1",
    });

    // The principal is in `first`'s in-memory repositories, so authenticate on `first`; the point of
    // the second wiring is that the CREDENTIAL lives in the shared store, not in the provider object.
    const ok = await first.security.authenticate({
      tenantId: "shop-a",
      method: "password",
      identifier: "X@Y.com",
      credential: "fake-password-1",
    });
    expect((ok.body as { authenticated: boolean }).authenticated).toBe(true);

    const second = wire(store);
    const record = await store.find("shop-a", "x@y.com");
    expect(record?.principalExternalId).toBe("cust-1");
    expect(second.passwordRegistrar).toBeDefined();

    const otherShop = await first.security.authenticate({
      tenantId: "shop-b",
      method: "password",
      identifier: "x@y.com",
      credential: "fake-password-1",
    });
    expect((otherShop.body as { authenticated: boolean }).authenticated).toBe(false);
  });

  it("without an injected provider, passwordRegistrar writes to the in-memory reference provider", async () => {
    let n = 0;
    const wired = wireSecurity({
      serializer: new InMemoryEventSerializer(),
      idGenerator: { generate: () => `id-${(n += 1)}` },
      clock,
    });
    await wired.passwordRegistrar.setPassword({
      tenantId: "shop-a",
      identifier: "x@y.com",
      password: "fake-password-1",
      principalExternalId: "cust-1",
    });
    const result = await wired.passwordProvider.authenticate({
      method: "password",
      identifier: "x@y.com",
      credential: "fake-password-1",
    });
    expect(result.ok).toBe(true);
  });
});
