import { describe, expect, it, vi } from "vitest";
import type { Database } from "@platform/db";
import { PrismaCustomerAnnotationRepository } from "./prisma-customer-annotation-repository";

const id = "00000000-0000-0000-0000-000000000001";
describe("PrismaCustomerAnnotationRepository", () => {
  it("requires a transaction even for invalid ids", async () => {
    expect.hasAssertions();
    const repo = new PrismaCustomerAnnotationRepository({ prisma: {} as Database });
    await expect(repo.setNote("bad", null, "a")).rejects.toThrow(
      "PrismaCustomerAnnotationRepository.setNote requires the unit of work's transaction client (ADR-0003).",
    );
    await expect(repo.replaceTags("bad", [], "a")).rejects.toThrow(
      "PrismaCustomerAnnotationRepository.replaceTags requires the unit of work's transaction client (ADR-0003).",
    );
    expect(await repo.setNote("bad", null, "a", {})).toBe(false);
    expect(await repo.replaceTags("bad", [], "a", {})).toBeNull();
    expect((await repo.annotationsOf(["bad"], "a")).size).toBe(0);
  });
  it("locks a tenant parent before replacement and skips empty inserts", async () => {
    const repo = new PrismaCustomerAnnotationRepository({ prisma: {} as Database });
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id }]),
      customerTag: {
        deleteMany: vi.fn().mockResolvedValue({}),
        createMany: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    expect(await repo.replaceTags(id, [], "a", tx)).toEqual([]);
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.customerTag.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: "a", customerId: id },
    });
    expect(tx.customerTag.createMany).not.toHaveBeenCalled();
    tx.$queryRaw.mockResolvedValue([]);
    expect(await repo.replaceTags(id, [], "b", tx)).toBeNull();
    expect(tx.customerTag.deleteMany).toHaveBeenCalledTimes(1);
  });
  it("populates the map under each requested uuid spelling and omits unmatched ids", async () => {
    expect.hasAssertions();
    const repo = new PrismaCustomerAnnotationRepository({ prisma: {} as Database });
    const lower = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const upper = lower.toUpperCase();
    const mixed = "AaAaAaAa-BbBb-CcCc-DdDd-EeEeEeEeEeEe";
    const other = "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee";
    const tx = {
      customer: {
        findMany: vi.fn().mockResolvedValue([{ id: lower, note: "n" }]),
      },
      customerTag: {
        findMany: vi.fn().mockResolvedValue([
          { customerId: lower, tag: "VIP" },
          { customerId: lower, tag: "Cairo" },
        ]),
      },
    };

    const read = await repo.annotationsOf(
      [upper, mixed, lower, other, "not-a-uuid", upper],
      "a",
      tx,
    );

    const expected = { note: "n", tags: ["Cairo", "VIP"] };
    expect([...read]).toEqual([
      [upper, expected],
      [mixed, expected],
      [lower, expected],
    ]);
    expect(tx.customer.findMany).toHaveBeenCalledWith({
      where: { tenantId: "a", deletedAt: null, id: { in: [lower, other] } },
      select: { id: true, note: true },
    });
  });
});
