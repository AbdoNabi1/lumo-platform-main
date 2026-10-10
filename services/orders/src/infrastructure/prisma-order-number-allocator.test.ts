import type { TransactionClient } from "@platform/db";
import { describe, expect, it } from "vitest";
import { PrismaOrderNumberAllocator } from "./prisma-order-number-allocator";

interface RawCall {
  readonly sql: string;
  readonly values: readonly unknown[];
}

/** A transaction client whose only capability is the tagged-template `$queryRaw` the allocator uses. */
function fakeTx(lastNumbers: readonly number[]) {
  const calls: RawCall[] = [];
  let next = 0;
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: strings.join("?"), values });
      const last_number = lastNumbers[next];
      next += 1;
      return [{ last_number }];
    },
  } as unknown as TransactionClient;
  return { tx, calls };
}

describe("PrismaOrderNumberAllocator", () => {
  it("runs one atomic upsert-and-increment, scoped to the tenant", async () => {
    const { tx, calls } = fakeTx([1001]);
    const allocator = new PrismaOrderNumberAllocator();

    await allocator.next("tenant-a", tx);

    expect(calls).toHaveLength(1);
    const sql = calls[0]?.sql.replace(/\s+/g, " ") ?? "";
    expect(sql).toContain('INSERT INTO "orders"."order_number_counters"');
    expect(sql).toContain('("tenant_id", "last_number")');
    expect(sql).toContain('ON CONFLICT ("tenant_id") DO UPDATE');
    expect(sql).toContain('SET "last_number" = "order_number_counters"."last_number" + 1');
    expect(sql).toContain('RETURNING "last_number"');
    // The tenant and the first number are bound parameters, never interpolated into the SQL text.
    expect(calls[0]?.values).toEqual(["tenant-a", 1001]);
  });

  it("returns the number as a digit string", async () => {
    const { tx } = fakeTx([1001, 1002]);
    const allocator = new PrismaOrderNumberAllocator();

    expect(await allocator.next("tenant-a", tx)).toBe("1001");
    expect(await allocator.next("tenant-a", tx)).toBe("1002");
  });

  it("refuses to run outside the order's transaction, so a failed order cannot burn a number", async () => {
    const allocator = new PrismaOrderNumberAllocator();

    await expect(allocator.next("tenant-a")).rejects.toThrow(/transaction/i);
  });

  it("fails loudly when the database returns no row", async () => {
    const tx = { $queryRaw: async () => [] } as unknown as TransactionClient;
    const allocator = new PrismaOrderNumberAllocator();

    await expect(allocator.next("tenant-a", tx)).rejects.toThrow(/order number/i);
  });
});
