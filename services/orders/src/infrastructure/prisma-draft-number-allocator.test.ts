import type { TransactionClient } from "@platform/db";
import { describe, expect, it } from "vitest";
import { InMemoryDraftNumberAllocator } from "./in-memory-draft-number-allocator";
import { PrismaDraftNumberAllocator } from "./prisma-draft-number-allocator";

function fakeTx(numbers: readonly number[]) {
  const calls: { sql: string; values: readonly unknown[] }[] = [];
  let next = 0;
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: strings.join("?"), values });
      const last_draft_number = numbers[next];
      next += 1;
      return [{ last_draft_number }];
    },
  } as unknown as TransactionClient;
  return { tx, calls };
}

describe("PrismaDraftNumberAllocator", () => {
  it("bumps last_draft_number on the shop's counter row; a new row keeps the first order at #1001", async () => {
    const { tx, calls } = fakeTx([1]);
    expect(await new PrismaDraftNumberAllocator().next("tenant-a", tx)).toBe("D1");
    const sql = calls[0]?.sql.replace(/\s+/g, " ") ?? "";
    expect(sql).toContain('INSERT INTO "orders"."order_number_counters"');
    expect(sql).toContain('("tenant_id", "last_number", "last_draft_number")');
    expect(sql).toContain('ON CONFLICT ("tenant_id") DO UPDATE');
    expect(sql).toContain(
      'SET "last_draft_number" = "order_number_counters"."last_draft_number" + 1',
    );
    expect(sql).not.toContain('SET "last_number"');
    // The tenant and the order-number floor are bound parameters, never interpolated.
    expect(calls[0]?.values).toEqual(["tenant-a", 1000]);
  });

  it("refuses to run outside the draft's transaction", async () => {
    await expect(new PrismaDraftNumberAllocator().next("tenant-a")).rejects.toThrow(/transaction/i);
  });

  it("fails loudly when the database returns no row", async () => {
    const tx = { $queryRaw: async () => [] } as unknown as TransactionClient;
    await expect(new PrismaDraftNumberAllocator().next("tenant-a", tx)).rejects.toThrow(
      /draft number/,
    );
  });
});

describe("InMemoryDraftNumberAllocator", () => {
  it("counts per shop from D1", async () => {
    const allocator = new InMemoryDraftNumberAllocator();
    expect(await allocator.next("a")).toBe("D1");
    expect(await allocator.next("a")).toBe("D2");
    expect(await allocator.next("b")).toBe("D1");
  });
});
