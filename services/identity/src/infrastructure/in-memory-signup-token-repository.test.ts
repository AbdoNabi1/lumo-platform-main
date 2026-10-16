import { describe, expect, it } from "vitest";
import { UniqueEntityId } from "@platform/domain";
import { SignupToken } from "../domain/signup-token";
import { InMemorySignupTokenRepository } from "./in-memory-signup-token-repository";

const NOW = new Date("2026-09-22T00:00:00.000Z");
const LATER = new Date("2026-09-23T00:00:00.000Z");

function token(id: string, tenantId: string, customerId: string, hash: string): SignupToken {
  return SignupToken.issue(UniqueEntityId.from(id), tenantId, customerId, hash, LATER);
}

describe("InMemorySignupTokenRepository", () => {
  it("finds a saved token by (tenantId, tokenHash)", async () => {
    const repo = new InMemorySignupTokenRepository();
    await repo.save(token("t1", "tenant-1", "cust-1", "hash-a"));
    const found = await repo.findByHash("hash-a", "tenant-1");
    expect(found?.customerId).toBe("cust-1");
  });

  it("does not find a token from another tenant", async () => {
    const repo = new InMemorySignupTokenRepository();
    await repo.save(token("t1", "tenant-1", "cust-1", "hash-a"));
    expect(await repo.findByHash("hash-a", "tenant-2")).toBeNull();
  });

  it("invalidateAllForCustomer consumes every valid token for that customer only", async () => {
    const repo = new InMemorySignupTokenRepository();
    const a = token("t1", "tenant-1", "cust-1", "hash-a");
    const b = token("t2", "tenant-1", "cust-2", "hash-b");
    await repo.save(a);
    await repo.save(b);
    await repo.invalidateAllForCustomer("cust-1", "tenant-1", NOW);
    expect(a.isValid(NOW)).toBe(false);
    expect(b.isValid(NOW)).toBe(true);
  });

  it("markConsumed wins the race exactly once", async () => {
    const repo = new InMemorySignupTokenRepository();
    await repo.save(token("t1", "tenant-1", "cust-1", "hash-a"));
    const first = await repo.markConsumed("t1", "tenant-1", NOW);
    const second = await repo.markConsumed("t1", "tenant-1", NOW);
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it("markConsumed returns false for a wrong-tenant id", async () => {
    const repo = new InMemorySignupTokenRepository();
    await repo.save(token("t1", "tenant-1", "cust-1", "hash-a"));
    expect(await repo.markConsumed("t1", "tenant-2", NOW)).toBe(false);
  });
});
