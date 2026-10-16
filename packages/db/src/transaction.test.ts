import { describe, expect, it, vi } from "vitest";
import { runInTenantTransaction, runReadScoped, runReadScopedBatched } from "./transaction";

/** Minimal fake standing in for `PrismaClient`/`Prisma.TransactionClient` — no live database. */
function fakePrisma() {
  const calls: string[] = [];
  const tx = {
    $executeRaw: vi.fn((_strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(`SET:${String(values[0])}`);
      return Promise.resolve(1);
    }),
  };
  const prisma = {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const result = await fn(tx);
      calls.push("COMMIT");
      return result;
    }),
  };
  return { prisma, tx, calls };
}

describe("runInTenantTransaction (ADR-0014)", () => {
  it("issues set_config('app.tenant_id', ...) as the first statement, before fn runs", async () => {
    const { prisma, calls } = fakePrisma();
    const order: string[] = [];

    await runInTenantTransaction(prisma as never, "tenant-a", async () => {
      order.push("fn");
      return "done";
    });

    expect(calls[0]).toBe("SET:tenant-a");
    expect(order).toEqual(["fn"]);
  });

  it("passes the tenantId as a bind parameter, not interpolated into SQL text", async () => {
    const { prisma, tx } = fakePrisma();

    await runInTenantTransaction(prisma as never, "tenant-b", async () => "x");

    const [strings, ...values] = (tx.$executeRaw as ReturnType<typeof vi.fn>).mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    // The tagged-template literal text must not contain the tenant id — it must arrive as a
    // separate bound value, exactly what makes this immune to SQL injection via tenantId.
    expect(strings.join("")).not.toContain("tenant-b");
    expect(values).toEqual(["tenant-b"]);
  });

  it("returns fn's result", async () => {
    const { prisma } = fakePrisma();
    const result = await runInTenantTransaction(prisma as never, "tenant-a", async () => 42);
    expect(result).toBe(42);
  });

  it("propagates fn's rejection without swallowing it", async () => {
    const { prisma } = fakePrisma();
    await expect(
      runInTenantTransaction(prisma as never, "tenant-a", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("threads maxWait/timeout through to $transaction's options", async () => {
    const { prisma } = fakePrisma();
    await runInTenantTransaction(prisma as never, "tenant-a", async () => "x", {
      maxWaitMs: 100,
      timeoutMs: 200,
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 100,
      timeout: 200,
    });
  });
});

describe("runReadScoped (ADR-0014 point 3)", () => {
  it("is the same tenant-scoping behavior as runInTenantTransaction, for read call sites", async () => {
    const { prisma, calls } = fakePrisma();

    const result = await runReadScoped(prisma as never, "tenant-a", async () => "rows");

    expect(calls[0]).toBe("SET:tenant-a");
    expect(result).toBe("rows");
  });
});

/**
 * Minimal fake for Prisma's ARRAY `$transaction([...])` form — structurally different from the
 * interactive form's fake above: `$executeRaw` is called standalone (not on a `tx`) and returns a
 * lazy op the fake `$transaction` resolves itself; `$transaction` receives an array, not a
 * callback.
 */
function fakeBatchedPrisma() {
  const setConfigCalls: unknown[] = [];
  const prisma = {
    $executeRaw: vi.fn((_strings: TemplateStringsArray, ...values: unknown[]) => {
      setConfigCalls.push(values[0]);
      return { __op: "set_config" };
    }),
    $transaction: vi.fn(async (ops: readonly unknown[]) => {
      const resolved = await Promise.all(ops.map((op) => Promise.resolve(op)));
      return resolved;
    }),
  };
  return { prisma, setConfigCalls };
}

describe("runReadScopedBatched (ADR-0014 2026-09-09 amendment)", () => {
  it("includes set_config('app.tenant_id', ...) as the first array element", async () => {
    const { prisma, setConfigCalls } = fakeBatchedPrisma();

    await runReadScopedBatched(prisma as never, "tenant-a", Promise.resolve("rows") as never);

    expect(setConfigCalls).toEqual(["tenant-a"]);
    const call = (prisma.$transaction as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call?.[0]).toHaveLength(2);
  });

  it("passes the tenantId as a bind parameter, not interpolated into SQL text", async () => {
    const { prisma } = fakeBatchedPrisma();

    await runReadScopedBatched(prisma as never, "tenant-b", Promise.resolve("x") as never);

    const [strings, ...values] = (prisma.$executeRaw as ReturnType<typeof vi.fn>).mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    expect(strings.join("")).not.toContain("tenant-b");
    expect(values).toEqual(["tenant-b"]);
  });

  it("returns the operation's result (the second array element), not the set_config result", async () => {
    const { prisma } = fakeBatchedPrisma();

    const result = await runReadScopedBatched(
      prisma as never,
      "tenant-a",
      Promise.resolve([{ id: "p1" }]) as never,
    );

    expect(result).toEqual([{ id: "p1" }]);
  });

  it("propagates a rejection from $transaction without swallowing it", async () => {
    const { prisma } = fakeBatchedPrisma();
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"));

    await expect(
      runReadScopedBatched(prisma as never, "tenant-a", Promise.resolve("x") as never),
    ).rejects.toThrow("boom");
  });

  it("makes exactly one $transaction call — a single client round trip, unlike the interactive form", async () => {
    const { prisma } = fakeBatchedPrisma();

    await runReadScopedBatched(prisma as never, "tenant-a", Promise.resolve("x") as never);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
