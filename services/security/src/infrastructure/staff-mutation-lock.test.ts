import { describe, expect, it } from "vitest";
import { InMemoryStaffMutationLock } from "./in-memory-staff-mutation-lock";
import { PrismaStaffMutationLock } from "./prisma-staff-mutation-lock";

describe("PrismaStaffMutationLock", () => {
  it("takes pg_advisory_xact_lock on the given tx before running fn", async () => {
    const calls: unknown[] = [];
    const tx = {
      $executeRawUnsafe: async (...args: unknown[]) => {
        calls.push(args);
      },
    };
    const lock = new PrismaStaffMutationLock();
    const result = await lock.withTenantStaffLock("tenant-a", tx, async () => {
      calls.push("fn");
      return 42;
    });
    expect(result).toBe(42);
    expect(calls).toEqual([
      ["SELECT pg_advisory_xact_lock(hashtext($1))", "security.staff:tenant-a"],
      "fn",
    ]);
  });

  it("throws without the unit of work's tx and never runs fn", async () => {
    const lock = new PrismaStaffMutationLock();
    let ran = false;
    for (const tx of [undefined, null]) {
      await expect(
        lock.withTenantStaffLock("tenant-a", tx, async () => {
          ran = true;
        }),
      ).rejects.toThrow(
        "PrismaStaffMutationLock.withTenantStaffLock requires the unit of work's transaction client (ADR-0003).",
      );
    }
    expect(ran).toBe(false);
  });

  it("does not run fn when taking the lock fails", async () => {
    const lock = new PrismaStaffMutationLock();
    let ran = false;
    const tx = {
      $executeRawUnsafe: async () => {
        throw new Error("lock timeout");
      },
    };
    await expect(
      lock.withTenantStaffLock("t", tx, async () => {
        ran = true;
      }),
    ).rejects.toThrow("lock timeout");
    expect(ran).toBe(false);
  });
});

describe("InMemoryStaffMutationLock", () => {
  const gate = () => {
    let open!: () => void;
    const promise = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { promise, open };
  };

  it("serializes two parallel critical sections for the same tenant", async () => {
    const lock = new InMemoryStaffMutationLock();
    const order: string[] = [];
    const g = gate();
    const first = lock.withTenantStaffLock("t", undefined, async () => {
      order.push("first:start");
      await g.promise;
      order.push("first:end");
    });
    const second = lock.withTenantStaffLock("t", undefined, async () => {
      order.push("second:start");
      order.push("second:end");
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(["first:start"]); // second is queued behind first
    g.open();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  it("does not serialize across tenants", async () => {
    const lock = new InMemoryStaffMutationLock();
    const order: string[] = [];
    const g = gate();
    const a = lock.withTenantStaffLock("a", undefined, async () => {
      order.push("a:start");
      await g.promise;
      order.push("a:end");
    });
    const b = lock.withTenantStaffLock("b", undefined, async () => {
      order.push("b:start");
      order.push("b:end");
    });
    await b;
    expect(order).toEqual(["a:start", "b:start", "b:end"]);
    g.open();
    await a;
    expect(order).toEqual(["a:start", "b:start", "b:end", "a:end"]);
  });

  it("releases the lock when fn throws and propagates the error", async () => {
    const lock = new InMemoryStaffMutationLock();
    await expect(
      lock.withTenantStaffLock("t", undefined, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await lock.withTenantStaffLock("t", undefined, async () => "next")).toBe("next");
  });

  it("returns fn's value", async () => {
    const lock = new InMemoryStaffMutationLock();
    expect(await lock.withTenantStaffLock("t", undefined, async () => 7)).toBe(7);
  });
});
