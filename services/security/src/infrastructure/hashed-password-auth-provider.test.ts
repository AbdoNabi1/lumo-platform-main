import { describe, expect, it } from "vitest";
import type { Clock } from "@platform/contracts";
import { HashedPasswordAuthProvider } from "./hashed-password-auth-provider";
import { InMemoryPasswordCredentialStore } from "./in-memory-password-credential-store";
import { ScryptPasswordHasher } from "./scrypt-password-hasher";

function setup(start = 0) {
  let now = start;
  const clock: Clock = { now: () => new Date(now) };
  const store = new InMemoryPasswordCredentialStore();
  const provider = new HashedPasswordAuthProvider({
    store,
    hasher: new ScryptPasswordHasher({ log2N: 10 }),
    clock,
    maxFailures: 3,
    lockoutSeconds: 60,
  });
  return { provider, store, advance: (ms: number) => (now += ms) };
}

const login = (tenantId: string | undefined, identifier: string, credential: string) => ({
  method: "password" as const,
  identifier,
  credential,
  ...(tenantId === undefined ? {} : { tenantId }),
});

describe("HashedPasswordAuthProvider", () => {
  it("authenticates a registered identifier, case- and space-insensitively", async () => {
    const { provider } = setup();
    await provider.setPassword({
      tenantId: "shop-a",
      identifier: "Sara@Example.com",
      password: "fake-password-1",
      principalExternalId: "cust-1",
    });
    const result = await provider.authenticate(
      login("shop-a", "  sara@example.COM ", "fake-password-1"),
    );
    expect(result).toEqual({ ok: true, principalExternalId: "cust-1" });
  });

  it("keeps shops apart: the same email in two shops is two credentials", async () => {
    const { provider } = setup();
    await provider.setPassword({
      tenantId: "shop-a",
      identifier: "x@y.com",
      password: "fake-password-a",
      principalExternalId: "a-1",
    });
    await provider.setPassword({
      tenantId: "shop-b",
      identifier: "x@y.com",
      password: "fake-password-b",
      principalExternalId: "b-1",
    });
    expect((await provider.authenticate(login("shop-a", "x@y.com", "fake-password-b"))).ok).toBe(
      false,
    );
    expect(await provider.authenticate(login("shop-b", "x@y.com", "fake-password-b"))).toEqual({
      ok: true,
      principalExternalId: "b-1",
    });
  });

  it("refuses without a tenant scope, for unknown identifiers and wrong passwords", async () => {
    const { provider } = setup();
    await provider.setPassword({
      tenantId: "shop-a",
      identifier: "x@y.com",
      password: "fake-password-1",
      principalExternalId: "a-1",
    });
    expect((await provider.authenticate(login(undefined, "x@y.com", "fake-password-1"))).ok).toBe(
      false,
    );
    expect(
      (await provider.authenticate(login("shop-a", "nobody@y.com", "fake-password-1"))).ok,
    ).toBe(false);
    expect((await provider.authenticate(login("shop-a", "x@y.com", "wrong-password"))).ok).toBe(
      false,
    );
  });

  it("locks after maxFailures for lockoutSeconds, then lets the right password in", async () => {
    const { provider, advance } = setup();
    await provider.setPassword({
      tenantId: "shop-a",
      identifier: "x@y.com",
      password: "fake-password-1",
      principalExternalId: "a-1",
    });
    for (let i = 0; i < 3; i += 1) {
      await provider.authenticate(login("shop-a", "x@y.com", "wrong-password"));
    }
    const locked = await provider.authenticate(login("shop-a", "x@y.com", "fake-password-1"));
    expect(locked).toEqual({ ok: false, reason: "credential temporarily locked" });
    advance(61_000);
    expect((await provider.authenticate(login("shop-a", "x@y.com", "fake-password-1"))).ok).toBe(
      true,
    );
  });

  it("a success resets the failure counter", async () => {
    const { provider, store } = setup();
    await provider.setPassword({
      tenantId: "shop-a",
      identifier: "x@y.com",
      password: "fake-password-1",
      principalExternalId: "a-1",
    });
    await provider.authenticate(login("shop-a", "x@y.com", "wrong-password"));
    await provider.authenticate(login("shop-a", "x@y.com", "fake-password-1"));
    expect((await store.find("shop-a", "x@y.com"))?.failedAttempts).toBe(0);
  });

  it("rejects passwords shorter than 8 or longer than 256 characters", async () => {
    const { provider } = setup();
    const base = { tenantId: "shop-a", identifier: "x@y.com", principalExternalId: "a-1" };
    await expect(provider.setPassword({ ...base, password: "short" })).rejects.toThrow(/8/);
    await expect(provider.setPassword({ ...base, password: "a".repeat(257) })).rejects.toThrow(
      /256/,
    );
  });

  it("stores only a hash", async () => {
    const { provider, store } = setup();
    await provider.setPassword({
      tenantId: "shop-a",
      identifier: "x@y.com",
      password: "fake-password-1",
      principalExternalId: "a-1",
    });
    const record = await store.find("shop-a", "x@y.com");
    expect(record?.passwordHash.startsWith("scrypt$")).toBe(true);
    expect(record?.passwordHash).not.toContain("fake-password-1");
  });
});
