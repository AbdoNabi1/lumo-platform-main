import { beforeEach, describe, expect, it } from "vitest";
import type { Database, TransactionClient } from "@platform/db";
import { StaffDirectoryEntry } from "../domain/staff-directory";
import { PrismaStaffDirectoryRepository } from "./prisma-repositories";

beforeEach(() => {
  expect.hasAssertions();
});

function fakeTx(count: number) {
  const calls: unknown[] = [];
  const tx = {
    staffDirectoryEntry: {
      deleteMany: async (args: unknown) => {
        calls.push(args);
        return { count };
      },
    },
  };
  return { tx: tx as unknown as TransactionClient, calls };
}

const deps = {
  prisma: undefined as unknown as Database,
  tenantId: "deployment-tenant",
  outbox: undefined as never,
  context: undefined as never,
};

function entry() {
  const created = StaffDirectoryEntry.createActive({
    email: "sam@shop.test",
    shopId: "shop-a",
    ownerExternalId: "ext-1",
  });
  if (!created.ok) throw new Error("fixture");
  return created.value;
}

describe("PrismaStaffDirectoryRepository.delete", () => {
  it("is a compare-and-delete on email, tenant, shop AND owner, inside the caller's transaction", async () => {
    const { tx, calls } = fakeTx(1);
    const removed = await new PrismaStaffDirectoryRepository(deps).delete(entry(), tx);
    expect(removed).toBe(true);
    expect(calls).toEqual([
      {
        where: {
          email: "sam@shop.test",
          tenantId: "deployment-tenant",
          shopRef: "shop-a",
          ownerExternalId: "ext-1",
        },
      },
    ]);
  });

  it("reports false when nothing matched", async () => {
    const { tx } = fakeTx(0);
    expect(await new PrismaStaffDirectoryRepository(deps).delete(entry(), tx)).toBe(false);
  });
});
