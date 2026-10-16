import { describe, expect, it } from "vitest";
import type { Clock } from "@platform/contracts";
import { HashedPasswordAuthProvider } from "../infrastructure/hashed-password-auth-provider";
import { InMemoryPasswordCredentialStore } from "../infrastructure/in-memory-password-credential-store";
import { InMemoryPasswordResetTokenStore } from "../infrastructure/in-memory-password-reset-token-store";
import { ScryptPasswordHasher } from "../infrastructure/scrypt-password-hasher";
import { PasswordResetService } from "./password-reset";

function setup() {
  let now = Date.parse("2026-10-07T10:00:00Z");
  const clock: Clock = { now: () => new Date(now) };
  const credentials = new InMemoryPasswordCredentialStore();
  const provider = new HashedPasswordAuthProvider({
    store: credentials,
    hasher: new ScryptPasswordHasher({ log2N: 10 }),
    clock,
  });
  const tokens = new InMemoryPasswordResetTokenStore();
  const service = new PasswordResetService({
    tokens,
    credentials,
    registrar: provider,
    clock,
    ttlSeconds: 1800,
  });
  const login = (password: string) =>
    provider.authenticate({
      tenantId: "t",
      method: "password",
      identifier: "staff:o@x.test",
      credential: password,
    });
  return { service, provider, tokens, login, advance: (ms: number) => (now += ms) };
}

const seed = (provider: HashedPasswordAuthProvider) =>
  provider.setPassword({
    tenantId: "t",
    identifier: "staff:o@x.test",
    password: "old-password-1",
    principalExternalId: "p-1",
  });

describe("PasswordResetService (Plan 1C)", () => {
  it("issues a token for a known identifier and none for an unknown one", async () => {
    const { service, provider } = setup();
    await seed(provider);
    const hit = await service.request("t", "staff:o@x.test");
    expect(hit?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await service.request("t", "staff:nobody@x.test")).toBeNull();
  });

  it("stores only a hash of the token", async () => {
    const { service, provider, tokens } = setup();
    await seed(provider);
    const hit = await service.request("t", "staff:o@x.test");
    expect(JSON.stringify([...tokens.snapshot()])).not.toContain(hit?.token ?? "x");
    expect(tokens.snapshot().length).toBe(1);
  });

  it("a token changes the password once; replay, expiry, other tenant and garbage all fail", async () => {
    const { service, provider, login, advance } = setup();
    await seed(provider);
    const first = await service.request("t", "staff:o@x.test");
    expect(await service.complete("other", first?.token ?? "", "new-password-1")).toBe(false);
    expect(await service.complete("t", first?.token ?? "", "new-password-1")).toBe(true);
    expect((await login("new-password-1")).ok).toBe(true);
    expect((await login("old-password-1")).ok).toBe(false);
    expect(await service.complete("t", first?.token ?? "", "another-password")).toBe(false);
    const second = await service.request("t", "staff:o@x.test");
    advance(1801_000);
    expect(await service.complete("t", second?.token ?? "", "late-password-1")).toBe(false);
    expect(await service.complete("t", "garbage", "whatever-password")).toBe(false);
  });

  it("a too-short new password is refused and does not burn the token", async () => {
    const { service, provider } = setup();
    await seed(provider);
    const hit = await service.request("t", "staff:o@x.test");
    await expect(service.complete("t", hit?.token ?? "", "short")).rejects.toThrow(/password/i);
    expect(await service.complete("t", hit?.token ?? "", "good-password-1")).toBe(true);
  });
});

describe("PasswordCredentialStore.findByPrincipal (Plan 1C)", () => {
  it("finds a credential by its owning principal, scoped to the tenant", async () => {
    const store = new InMemoryPasswordCredentialStore();
    await store.save({
      tenantId: "t",
      identifier: "staff:o@x.test",
      principalExternalId: "p-1",
      passwordHash: "h",
    });
    expect((await store.findByPrincipal("t", "p-1"))?.identifier).toBe("staff:o@x.test");
    expect(await store.findByPrincipal("other", "p-1")).toBeNull();
    expect(await store.findByPrincipal("t", "p-2")).toBeNull();
  });
});
