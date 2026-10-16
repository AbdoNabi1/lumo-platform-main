import { describe, expect, it } from "vitest";
import { InMemoryOrderNumberAllocator } from "./in-memory-order-number-allocator";

describe("InMemoryOrderNumberAllocator", () => {
  it("numbers a shop's orders 1001, 1002, … in order", async () => {
    const allocator = new InMemoryOrderNumberAllocator();

    expect(await allocator.next("tenant-a")).toBe("1001");
    expect(await allocator.next("tenant-a")).toBe("1002");
    expect(await allocator.next("tenant-a")).toBe("1003");
  });

  it("starts every shop at 1001, independently of the others", async () => {
    const allocator = new InMemoryOrderNumberAllocator();

    expect(await allocator.next("tenant-a")).toBe("1001");
    expect(await allocator.next("tenant-a")).toBe("1002");
    expect(await allocator.next("tenant-b")).toBe("1001");
    expect(await allocator.next("tenant-a")).toBe("1003");
  });
});
